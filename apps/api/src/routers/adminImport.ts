import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { adminImportProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { computeCommitToken, verifyCommitToken, summarize } from '../import/engine.js'
import { validateTaxClassRows, commitTaxClassRows } from '../import/domains/taxClasses.js'
import type { ImportDomainKey, ImportRowResult } from '../import/types.js'

const domainSchema = z.enum([
  'taxClasses', 'commercialMastersFlat', 'currencies', 'approvalMatrix',
  'commercialMastersCatalog', 'organizationHierarchy', 'employees',
  'salesRoster', 'skus', 'bom',
])

// Only 'taxClasses' is wired in Phase 1 — every other key throws NOT_IMPLEMENTED
// with a clear message until its Phase-2 task plugs it in here. Geography is
// deliberately absent from this map: it has its own previewGeographyLoad/
// commitGeographyLoad procedures (Phase 3), not validate/commit.
const VALIDATORS: Partial<Record<ImportDomainKey, (client: any, rows: unknown[]) => Promise<ImportRowResult[]>>> = {
  taxClasses: validateTaxClassRows,
}
const COMMITTERS: Partial<Record<ImportDomainKey, (client: any, rows: unknown[], preview: ImportRowResult[]) => Promise<void>>> = {
  taxClasses: commitTaxClassRows,
}

function requireWired(domain: ImportDomainKey) {
  const validate = VALIDATORS[domain]
  const commit = COMMITTERS[domain]
  if (!validate || !commit) {
    throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: `Import for "${domain}" is not available yet.` })
  }
  return { validate, commit }
}

export const adminImportRouter = router({
  validate: adminImportProcedure
    .input(z.object({ domain: domainSchema, rows: z.array(z.record(z.any())).max(5000) }))
    .mutation(async ({ input }) => {
      const { validate } = requireWired(input.domain)
      const rows = await validate(pool, input.rows)
      return { rows, summary: summarize(rows), commitToken: computeCommitToken(input.domain, input.rows) }
    }),

  commit: adminImportProcedure
    .input(z.object({ domain: domainSchema, commitToken: z.string(), rows: z.array(z.record(z.any())).max(5000) }))
    .mutation(async ({ input }) => {
      const { validate, commit } = requireWired(input.domain)
      if (!verifyCommitToken(input.domain, input.rows, input.commitToken)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This data has changed since it was previewed. Please re-validate before committing.' })
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Re-validate against the database as it is right now, inside the
        // transaction, so a conflicting concurrent import can't slip through
        // between this admin's preview and their click on Commit.
        const freshPreview = await validate(client, input.rows)
        await commit(client, input.rows, freshPreview)
        await client.query('COMMIT')
        return { summary: summarize(freshPreview) }
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  listDomains: adminImportProcedure.query(async () => {
    const counts = await pool.query(
      `SELECT master_key, COUNT(*) FROM commercial_masters WHERE master_key='taxClasses' GROUP BY master_key`,
    )
    const taxClassesCount = Number(counts.rows[0]?.count ?? 0)
    return [
      { domain: 'taxClasses' as const, label: 'Tax Classes', currentRowCount: taxClassesCount, dependencyStatus: 'ready' as const },
    ]
  }),
})

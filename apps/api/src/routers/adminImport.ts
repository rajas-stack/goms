import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { adminImportProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { MAX_IMPORT_ROWS } from '../import/engine.js'
import { previewGeographyLoad, commitGeographyLoad } from '../import/domains/geography.js'
import { recordImportRun, listImportHistory, listSessionHistory } from '../import/auditLog.js'
import { runSessionValidate, runSessionCommit } from '../import/session/orchestrator.js'
import type { ImportDomainKey } from '../import/types.js'
import type { ExcludedRow } from '../import/session/types.js'

const domainSchema = z.enum([
  'taxClasses', 'commercialMastersFlat', 'currencies', 'approvalMatrix',
  'commercialMastersCatalog', 'organizationHierarchy', 'employees',
  'salesRoster', 'skus', 'bom',
])

// Most domains submit a flat array of rows; the 3 multi-sheet domains submit
// a { sheetName: rows[] } dictionary instead. Enforced PER DOMAIN (not just
// in aggregate) so one domain in a large session can't silently swallow
// another's row budget.
const domainRowsSchema = z.union([
  z.array(z.record(z.any())),
  z.record(z.string(), z.array(z.record(z.any()))),
]).refine(
  (rows) => {
    const total = Array.isArray(rows) ? rows.length : Object.values(rows).reduce((sum, sheet) => sum + sheet.length, 0)
    return total <= MAX_IMPORT_ROWS
  },
  { message: `Total rows for one domain must not exceed ${MAX_IMPORT_ROWS}` },
)

const sessionDomainsSchema = z.record(domainSchema, domainRowsSchema)

const excludedRowSchema: z.ZodType<ExcludedRow> = z.object({
  domain: domainSchema,
  rowNumber: z.number(),
  sheet: z.string().optional(),
  // The field runSessionCommit's applyExclusions actually matches on (Task
  // 7) — the multi-sheet domain's internal key ('persons', 'verticals',
  // ...), never the human `sheet` label above. Optional because it's absent
  // for single-array domains.
  sheetKey: z.string().optional(),
  businessKey: z.string(),
  reason: z.string().min(1, 'A reason is required to exclude a row'),
})

export const adminImportRouter = router({
  session: router({
    validate: adminImportProcedure
      .input(z.object({ domains: sessionDomainsSchema }))
      .mutation(({ input }) => runSessionValidate(pool, { domains: input.domains as any })),

    commit: adminImportProcedure
      .input(z.object({ domains: sessionDomainsSchema, sessionCommitToken: z.string(), excludedRows: z.array(excludedRowSchema) }))
      .mutation(({ input }) => runSessionCommit(pool, { domains: input.domains as any, sessionCommitToken: input.sessionCommitToken, excludedRows: input.excludedRows })),

    history: adminImportProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(({ input }) => listSessionHistory(input.sessionId)),
  }),

  // Per-domain history is kept (not session-scoped) for the domain list's
  // own "current row count" trend view — unaffected by this task.
  history: adminImportProcedure
    .input(z.object({ domain: domainSchema }))
    .query(({ input }) => listImportHistory(input.domain)),

  previewGeographyLoad: adminImportProcedure.mutation(() => previewGeographyLoad(pool)),

  commitGeographyLoad: adminImportProcedure
    .input(z.object({ commitToken: z.string() }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await commitGeographyLoad(client, input.commitToken)
        // Geography stays outside the session engine (design spec §4 treats
        // it as an always-'ready' root with no uploaded rows) — its own
        // one-off session id, one domain.
        await recordImportRun(client, randomUUID(), 'geography', result.summary, [], [])
        await client.query('COMMIT')
        return result
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  listDomains: adminImportProcedure.query(async () => {
    const geoCountResult = await pool.query(`SELECT COUNT(*) FROM hierarchy_nodes WHERE domain='geo'`)
    const geographyCount = Number(geoCountResult.rows[0].count)

    const countResult = await pool.query(
      `SELECT master_key, COUNT(*) FROM commercial_masters GROUP BY master_key
       UNION ALL SELECT 'employees', COUNT(*) FROM employees
       UNION ALL SELECT 'organizationHierarchy', COUNT(*) FROM hierarchy_nodes WHERE domain='org'
       UNION ALL SELECT 'salesPersons', COUNT(*) FROM sales_persons
       UNION ALL SELECT 'skus', COUNT(*) FROM commercial_skus
       UNION ALL SELECT 'bom', COUNT(*) FROM commercial_bom_items`,
    )
    const countByKey = new Map<string, number>(countResult.rows.map((r: { master_key: string; count: string }) => [r.master_key, Number(r.count)]))
    const flatSheetTotal = ['skuCategories', 'unitsOfMeasure', 'productEditions', 'billingTypes', 'preSales']
      .reduce((sum, key) => sum + (countByKey.get(key) ?? 0), 0)
    const catalogTotal = ['verticals', 'products', 'modules', 'features'].reduce((sum, key) => sum + (countByKey.get(key) ?? 0), 0)

    return [
      { domain: 'geography' as const, label: 'Geography', currentRowCount: geographyCount, dependencyStatus: 'ready' as const },
      { domain: 'organizationHierarchy' as const, label: 'Organization Hierarchy', currentRowCount: countByKey.get('organizationHierarchy') ?? 0, dependencyStatus: 'ready' as const },
      { domain: 'employees' as const, label: 'Employees', currentRowCount: countByKey.get('employees') ?? 0, dependencyStatus: (countByKey.get('organizationHierarchy') ?? 0) > 0 ? 'ready' as const : { blockedOn: ['organizationHierarchy'] as ImportDomainKey[] } },
      { domain: 'salesRoster' as const, label: 'Sales Roster & Postings', currentRowCount: countByKey.get('salesPersons') ?? 0, dependencyStatus: 'ready' as const },
      { domain: 'commercialMastersCatalog' as const, label: 'Commercial Masters — Catalog Structure', currentRowCount: catalogTotal, dependencyStatus: 'ready' as const },
      { domain: 'commercialMastersFlat' as const, label: 'Commercial Masters — Flat Reference Lists', currentRowCount: flatSheetTotal, dependencyStatus: 'ready' as const },
      { domain: 'currencies' as const, label: 'Currencies', currentRowCount: countByKey.get('currencies') ?? 0, dependencyStatus: 'ready' as const },
      { domain: 'taxClasses' as const, label: 'Tax Classes', currentRowCount: countByKey.get('taxClasses') ?? 0, dependencyStatus: 'ready' as const },
      { domain: 'approvalMatrix' as const, label: 'Approval Matrix', currentRowCount: countByKey.get('approvalMatrix') ?? 0, dependencyStatus: 'ready' as const },
      {
        domain: 'skus' as const, label: 'SKUs', currentRowCount: countByKey.get('skus') ?? 0,
        dependencyStatus: catalogTotal > 0 && flatSheetTotal > 0 ? 'ready' as const : { blockedOn: ['commercialMastersCatalog', 'commercialMastersFlat'] as ImportDomainKey[] },
      },
      {
        domain: 'bom' as const, label: 'BOM', currentRowCount: countByKey.get('bom') ?? 0,
        dependencyStatus: (countByKey.get('skus') ?? 0) > 0 ? 'ready' as const : { blockedOn: ['skus'] as ImportDomainKey[] },
      },
    ]
  }),
})

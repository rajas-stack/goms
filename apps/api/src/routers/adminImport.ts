import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { adminImportProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { computeCommitToken, verifyCommitToken, summarize, MAX_IMPORT_ROWS } from '../import/engine.js'
import { validateTaxClassRows, commitTaxClassRows } from '../import/domains/taxClasses.js'
import { validateFlatMasterRows, commitFlatMasterRows, type FlatMasterSheetKey } from '../import/domains/commercialMastersFlat.js'
import { validateCurrencyRows, commitCurrencyRows } from '../import/domains/currencies.js'
import { validateApprovalMatrixRows, commitApprovalMatrixRows } from '../import/domains/approvalMatrix.js'
import { validateCatalogRows, commitCatalogRows, type CatalogRows, type CatalogPreview } from '../import/domains/commercialMastersCatalog.js'
import { validateOrgHierarchyRows, commitOrgHierarchyRows } from '../import/domains/organizationHierarchy.js'
import { validateEmployeeRows, commitEmployeeRows } from '../import/domains/employees.js'
import { validateSalesRosterRows, commitSalesRosterRows } from '../import/domains/salesRoster.js'
import { validateSkuRows, commitSkuRows } from '../import/domains/skus.js'
import { validateBomRows, commitBomRows } from '../import/domains/bom.js'
import { recordImportRun, listImportHistory } from '../import/auditLog.js'
import type { ImportDomainKey, ImportRowResult } from '../import/types.js'

const domainSchema = z.enum([
  'taxClasses', 'commercialMastersFlat', 'currencies', 'approvalMatrix',
  'commercialMastersCatalog', 'organizationHierarchy', 'employees',
  'salesRoster', 'skus', 'bom',
])

const FLAT_SHEET_KEYS: FlatMasterSheetKey[] = ['skuCategories', 'unitsOfMeasure', 'productEditions', 'billingTypes']

// Every domain's rows/preview shape, and how validate/commit is actually
// invoked for it. Most domains are "flat": one array of rows in, one
// ImportRowResult[] out. Three are genuinely multi-sheet (Commercial
// Masters Flat/Catalog, Sales Roster) — their own importer modules already
// take/return a `{ sheetName: T[] }` shape (built and tested that way,
// since each domain's real structure calls for it), so the router adapts
// to that shape rather than forcing every domain into one uniform array.
interface DomainAdapter {
  validate: (client: any, rows: any) => Promise<any>
  commit: (client: any, rows: any, preview: any) => Promise<void>
  /** Flattens this domain's preview (a plain array, or a { sheet: [...] }
   *  dict for multi-sheet domains) into one combined summary/rejected-rows
   *  list for the commit-token/audit-log/summary machinery below, which is
   *  otherwise domain-shape-agnostic. */
  flatten: (preview: any) => ImportRowResult[]
}

const ADAPTERS: Partial<Record<ImportDomainKey, DomainAdapter>> = {
  taxClasses: {
    validate: (client, rows) => validateTaxClassRows(client, rows),
    commit: (client, rows, preview) => commitTaxClassRows(client, rows, preview),
    flatten: (preview) => preview,
  },
  currencies: {
    validate: (client, rows) => validateCurrencyRows(client, rows),
    commit: (client, rows, preview) => commitCurrencyRows(client, rows, preview),
    flatten: (preview) => preview,
  },
  approvalMatrix: {
    validate: (client, rows) => validateApprovalMatrixRows(client, rows),
    commit: (client, rows, preview) => commitApprovalMatrixRows(client, rows, preview),
    flatten: (preview) => preview,
  },
  organizationHierarchy: {
    validate: (client, rows) => validateOrgHierarchyRows(client, rows),
    commit: (client, rows, preview) => commitOrgHierarchyRows(client, rows, preview),
    flatten: (preview) => preview,
  },
  employees: {
    validate: (client, rows) => validateEmployeeRows(client, rows),
    commit: (client, rows, preview) => commitEmployeeRows(client, rows, preview),
    flatten: (preview) => preview,
  },
  skus: {
    validate: (client, rows) => validateSkuRows(client, rows),
    commit: (client, rows, preview) => commitSkuRows(client, rows, preview),
    flatten: (preview) => preview,
  },
  bom: {
    validate: (client, rows) => validateBomRows(client, rows),
    commit: (client, rows, preview) => commitBomRows(client, rows, preview),
    flatten: (preview) => preview,
  },

  // Multi-sheet: one INSERT/UPDATE-safe pair of functions shared across the
  // 4 independent skuCategories/unitsOfMeasure/productEditions/billingTypes
  // sheets, parameterized by sheet key.
  commercialMastersFlat: {
    validate: async (client, rows: Record<string, unknown[]>) => {
      const preview: Record<string, ImportRowResult[]> = {}
      for (const sheetKey of FLAT_SHEET_KEYS) preview[sheetKey] = await validateFlatMasterRows(client, sheetKey, rows[sheetKey] ?? [])
      return preview
    },
    commit: async (client, rows: Record<string, unknown[]>, preview: Record<string, ImportRowResult[]>) => {
      for (const sheetKey of FLAT_SHEET_KEYS) await commitFlatMasterRows(client, sheetKey, rows[sheetKey] ?? [], preview[sheetKey] ?? [])
    },
    flatten: (preview: Record<string, ImportRowResult[]>) => Object.values(preview).flat(),
  },

  // Multi-sheet: Verticals -> Products -> Modules -> Features, already
  // built and tested as one `{verticals,products,modules,features}` pair —
  // a direct passthrough, no adaptation needed.
  commercialMastersCatalog: {
    validate: (client, rows: CatalogRows) => validateCatalogRows(client, rows),
    commit: (client, rows: CatalogRows, preview: CatalogPreview) => commitCatalogRows(client, rows, preview),
    flatten: (preview: CatalogPreview) => [...preview.verticals, ...preview.products, ...preview.modules, ...preview.features],
  },

  // Multi-sheet: Sales Persons + Postings, already built and tested as one
  // `{persons,postings}` pair — a direct passthrough.
  salesRoster: {
    validate: (client, rows: { persons: unknown[]; postings: unknown[] }) => validateSalesRosterRows(client, rows),
    commit: (client, rows: { persons: unknown[]; postings: unknown[] }, preview) => commitSalesRosterRows(client, rows, preview),
    flatten: (preview: { persons: ImportRowResult[]; postings: ImportRowResult[] }) => [...preview.persons, ...preview.postings],
  },
}

function requireWired(domain: ImportDomainKey): DomainAdapter {
  const adapter = ADAPTERS[domain]
  if (!adapter) {
    throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: `Import for "${domain}" is not available yet.` })
  }
  return adapter
}

// Most domains submit a flat array of rows; the 3 multi-sheet domains
// submit a { sheetName: rows[] } dictionary instead. Total row count across
// either shape is capped at MAX_IMPORT_ROWS.
const rowsSchema = z.union([
  z.array(z.record(z.any())),
  z.record(z.string(), z.array(z.record(z.any()))),
]).refine(
  (rows) => {
    const total = Array.isArray(rows) ? rows.length : Object.values(rows).reduce((sum, sheet) => sum + sheet.length, 0)
    return total <= MAX_IMPORT_ROWS
  },
  { message: `Total rows must not exceed ${MAX_IMPORT_ROWS}` },
)

export const adminImportRouter = router({
  validate: adminImportProcedure
    .input(z.object({ domain: domainSchema, rows: rowsSchema }))
    .mutation(async ({ input }) => {
      const adapter = requireWired(input.domain)
      const preview = await adapter.validate(pool, input.rows)
      return { preview, summary: summarize(adapter.flatten(preview)), commitToken: computeCommitToken(input.domain, input.rows) }
    }),

  commit: adminImportProcedure
    .input(z.object({ domain: domainSchema, commitToken: z.string(), rows: rowsSchema }))
    .mutation(async ({ input }) => {
      const adapter = requireWired(input.domain)
      if (!verifyCommitToken(input.domain, input.rows, input.commitToken)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This data has changed since it was previewed. Please re-validate before committing.' })
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Re-validate against the database as it is right now, inside the
        // transaction, so a conflicting concurrent import can't slip through
        // between this admin's preview and their click on Commit.
        const freshPreview = await adapter.validate(client, input.rows)
        await adapter.commit(client, input.rows, freshPreview)
        const flatPreview = adapter.flatten(freshPreview)
        const summaryResult = summarize(flatPreview)
        await recordImportRun(client, input.domain, summaryResult, flatPreview)
        await client.query('COMMIT')
        return { summary: summaryResult }
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  history: adminImportProcedure
    .input(z.object({ domain: domainSchema }))
    .query(({ input }) => listImportHistory(input.domain)),

  listDomains: adminImportProcedure.query(async () => {
    const countResult = await pool.query(
      `SELECT master_key, COUNT(*) FROM commercial_masters GROUP BY master_key
       UNION ALL SELECT 'employees', COUNT(*) FROM employees
       UNION ALL SELECT 'organizationHierarchy', COUNT(*) FROM hierarchy_nodes WHERE domain='org'
       UNION ALL SELECT 'salesPersons', COUNT(*) FROM sales_persons
       UNION ALL SELECT 'skus', COUNT(*) FROM commercial_skus
       UNION ALL SELECT 'bom', COUNT(*) FROM commercial_bom_items`,
    )
    const countByKey = new Map<string, number>(countResult.rows.map((r: { master_key: string; count: string }) => [r.master_key, Number(r.count)]))
    const flatSheetTotal = FLAT_SHEET_KEYS.reduce((sum, key) => sum + (countByKey.get(key) ?? 0), 0)
    const catalogTotal = ['verticals', 'products', 'modules', 'features'].reduce((sum, key) => sum + (countByKey.get(key) ?? 0), 0)

    return [
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

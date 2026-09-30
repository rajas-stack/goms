import { TRPCError } from '@trpc/server'
import { validateTaxClassRows, commitTaxClassRows } from '../domains/taxClasses.js'
import { validateFlatMasterRows, commitFlatMasterRows, type FlatMasterSheetKey } from '../domains/commercialMastersFlat.js'
import { validateCurrencyRows, commitCurrencyRows } from '../domains/currencies.js'
import { validateApprovalMatrixRows, commitApprovalMatrixRows } from '../domains/approvalMatrix.js'
import { validateCatalogRows, commitCatalogRows, type CatalogRows, type CatalogPreview } from '../domains/commercialMastersCatalog.js'
import { validateOrgHierarchyRows, commitOrgHierarchyRows } from '../domains/organizationHierarchy.js'
import { validateEmployeeRows, commitEmployeeRows } from '../domains/employees.js'
import { validateSalesRosterRows, commitSalesRosterRows } from '../domains/salesRoster.js'
import { validateSkuRows, commitSkuRows } from '../domains/skus.js'
import { validateBomRows, commitBomRows } from '../domains/bom.js'
import { validateBidRows, commitBidRows } from '../domains/bids.js'
import { validateBidMilestoneRows, commitBidMilestoneRows } from '../domains/bidMilestones.js'
import type { ImportDomainKey, ImportRowResult } from '../types.js'

export const FLAT_SHEET_KEYS: FlatMasterSheetKey[] = ['skuCategories', 'unitsOfMeasure', 'productEditions', 'billingTypes', 'preSales']

export interface DomainAdapter {
  validate: (client: any, rows: any) => Promise<any>
  commit: (client: any, rows: any, preview: any) => Promise<void>
  flatten: (preview: any) => ImportRowResult[]
}

export const ADAPTERS: Partial<Record<ImportDomainKey, DomainAdapter>> = {
  bids: {
    validate: (client, rows) => validateBidRows(client, rows),
    commit: (client, rows, preview) => commitBidRows(client, rows, preview),
    flatten: (preview) => preview,
  },
  bidMilestones: {
    validate: (client, rows) => validateBidMilestoneRows(client, rows),
    commit: (client, rows, preview) => commitBidMilestoneRows(client, rows, preview),
    flatten: (preview) => preview,
  },
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
  commercialMastersCatalog: {
    validate: (client, rows: CatalogRows) => validateCatalogRows(client, rows),
    commit: (client, rows: CatalogRows, preview: CatalogPreview) => commitCatalogRows(client, rows, preview),
    flatten: (preview: CatalogPreview) => [...preview.verticals, ...preview.products, ...preview.modules, ...preview.features],
  },
  salesRoster: {
    validate: (client, rows: { persons: unknown[]; postings: unknown[] }) => validateSalesRosterRows(client, rows),
    commit: (client, rows: { persons: unknown[]; postings: unknown[] }, preview) => commitSalesRosterRows(client, rows, preview),
    flatten: (preview: { persons: ImportRowResult[]; postings: ImportRowResult[] }) => [...preview.persons, ...preview.postings],
  },
}

export function requireWired(domain: ImportDomainKey): DomainAdapter {
  const adapter = ADAPTERS[domain]
  if (!adapter) {
    throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: `Import for "${domain}" is not available yet.` })
  }
  return adapter
}

/** The 12 Commercial Calculator master "kinds", stored in one generic table
 *  (`commercial_masters`, keyed by `master_key`) rather than 12 separate
 *  tables. Shared by the frontend's in-memory `master-rules.ts` and
 *  `apps/api`'s commercial router so the Vertical→Product→Module→Feature
 *  parent/child rules and the code-uniqueness check reflect one
 *  authoritative definition. */
export type CommercialMasterKey =
  | 'verticals' | 'products' | 'modules' | 'features'
  | 'skuCategories' | 'unitsOfMeasure' | 'productEditions' | 'billingTypes'
  | 'taxClasses' | 'approvalMatrix' | 'currencies' | 'preSales'

export const COMMERCIAL_MASTER_KEYS: CommercialMasterKey[] = [
  'verticals', 'products', 'modules', 'features', 'skuCategories', 'unitsOfMeasure',
  'productEditions', 'billingTypes', 'taxClasses', 'approvalMatrix', 'currencies', 'preSales',
]

/** Parent-FK field name for each hierarchy master, keyed by child. */
export const MASTER_PARENT_FIELD: Partial<Record<CommercialMasterKey, { parentKey: CommercialMasterKey; field: string }>> = {
  products: { parentKey: 'verticals', field: 'verticalId' },
  modules: { parentKey: 'products', field: 'productId' },
  features: { parentKey: 'modules', field: 'moduleId' },
}

/** The inverse of `MASTER_PARENT_FIELD` — which master (if any) treats this
 *  master as its parent. Drives the delete guard: a row with children can't
 *  be deleted out from under them. */
export const MASTER_CHILD_OF: Partial<Record<CommercialMasterKey, { childKey: CommercialMasterKey; field: string }>> = {
  verticals: { childKey: 'products', field: 'verticalId' },
  products: { childKey: 'modules', field: 'productId' },
  modules: { childKey: 'features', field: 'moduleId' },
}

/** Extra field names — beyond code/name/description/active/displayOrder and
 *  any parent FK — each master kind carries. On the backend these live in
 *  `commercial_masters.extra` (JSONB); the frontend's in-memory rows carry
 *  them as flat properties instead (see `types.ts`). */
export const MASTER_EXTRA_FIELDS: Record<CommercialMasterKey, string[]> = {
  verticals: [], products: [], modules: [],
  features: ['status'],
  skuCategories: [], unitsOfMeasure: [], productEditions: [], billingTypes: [],
  taxClasses: ['ratePct'],
  approvalMatrix: ['minDiscountPct', 'maxDiscountPct', 'approvalLevelLabel', 'allowAutoApproval'],
  currencies: ['symbol', 'decimalPlaces', 'exchangeRate', 'isBaseCurrency'],
  preSales: [],
}

/** Finds a case-insensitive, trimmed code clash among sibling rows (same
 *  master kind), excluding the row being updated. Pure — callers own how the
 *  candidate rows were fetched (in-memory array vs. a DB query already
 *  scoped to `master_key`). */
export function findMasterCodeClash<T extends { id: string; code: string }>(
  rows: T[], code: string, excludeId: string | null,
): T | undefined {
  const trimmed = code.trim()
  return rows.find((r) => r.id !== excludeId && r.code.toLowerCase() === trimmed.toLowerCase())
}

/** Enforces "exactly one base currency": setting the winner's flag true and
 *  clearing every other row's, in place. */
export function enforceSingleBaseCurrency(rows: { id: string; isBaseCurrency: boolean }[], winnerId: string): void {
  for (const row of rows) {
    row.isBaseCurrency = row.id === winnerId
  }
}

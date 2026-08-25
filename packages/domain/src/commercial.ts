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

// --- SKU code generation (spec §7 / PCS-012) -------------------------------

export const FEATURE_STATUS_CODE: Record<string, string> = { existing: 'EXG', modified: 'MOD', new: 'NEW' }

/** Format `{Vertical.code}-{Product.code}-{Module.code}-{Feature.code}-{STATUS}`,
 *  uppercased. Pure string formatting only — resolving the feature's
 *  vertical/product/module ancestry (an in-memory array walk on the
 *  frontend, a `parent_id` chain query on the backend) stays with each
 *  caller, since those two traversals have no shared shape to extract. */
export function buildSkuCode(
  verticalCode: string, productCode: string, moduleCode: string, featureCode: string, featureStatus: string,
): string {
  const statusCode = FEATURE_STATUS_CODE[featureStatus] ?? 'NEW'
  return `${verticalCode}-${productCode}-${moduleCode}-${featureCode}-${statusCode}`.toUpperCase()
}

// --- SKU changeReason gating (spec §15/§6.6) -------------------------------

/** Fields whose change on a `CommercialSku` requires a non-empty
 *  `changeReason` — shared by the frontend's `updateSkuLogic` (audit-log
 *  writer) and `apps/api`'s `commercial.skus.update` procedure (gate only;
 *  audit persistence itself arrives with `commercial_audit_logs` in a later
 *  phase) so the two never independently drift on which fields are
 *  "sensitive". */
export const SKU_COST_FIELDS = [
  'baseSoftwareCost', 'implementationCostPerMM', 'integrationCost', 'thirdPartyCost',
  'hardwareCost', 'cloudCost', 'supportCost', 'trainingCost',
] as const

export const SKU_PRICE_FIELDS = [
  'internalPrice', 'floorPrice', 'partnerPrice', 'governmentPrice', 'enterprisePrice', 'corporatePrice', 'listPrice',
  'minimumAllowedPrice', 'maximumDiscountPercent',
] as const

export const SKU_SENSITIVE_FIELDS: string[] = ['lifecycleStatus', ...SKU_COST_FIELDS, ...SKU_PRICE_FIELDS]

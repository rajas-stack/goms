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

// --- BOQ state machine (spec §10) ------------------------------------------
//
// Shared by the frontend's `repository-logic.ts` and `apps/api`'s BOQ router
// so a BOQ's lifecycle graph has exactly one definition — unlike the smaller,
// per-side-reimplemented invariants in earlier phases (moveNode's cycle
// check, resolveApprovalBand), this is a small explicit graph with no
// traversal cost to share, so there is no reason for the two sides to risk
// drifting on which transitions are legal.

export type BoqStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'cancelled' | 'archived'

/** `cancelled`/`archived` are terminal; a decision already reached
 *  (`approved`/`rejected`) can only move to `archived`, never `cancelled`. */
export const BOQ_TRANSITIONS: Record<BoqStatus, BoqStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['archived'],
  rejected: ['archived'],
  cancelled: [],
  archived: [],
}

/** "Pending Approval" is defined by exclusion, not enumeration — a future
 *  status added to the union counts as pending unless explicitly listed here. */
export function isBoqPendingApproval(status: BoqStatus): boolean {
  return !['draft', 'approved', 'rejected', 'cancelled', 'archived'].includes(status)
}

/** The only two line-level states that mean "this discount is actually
 *  cleared" — an explicit whitelist, not "exclude pending", so a `rejected`
 *  line also blocks the document from reaching `approved`. */
export const LINE_STATES_CLEARED_FOR_APPROVAL: ('auto_approved' | 'pending' | 'approved' | 'rejected')[] = ['auto_approved', 'approved']

/** A BOQ still in an active pipeline state must be cancelled first (an
 *  existing `BOQ_TRANSITIONS` move) before it can be deleted. */
export const DELETABLE_BOQ_STATUSES: BoqStatus[] = ['draft', 'cancelled', 'rejected', 'archived']

/** Format only — `BOQ-{year}-{6-digit sequence}`. The allocation mechanism
 *  (an in-memory per-year counter vs. Postgres's
 *  `commercial_boq_number_sequences` row) stays per-side; only the shape both
 *  sides must agree on is shared. */
export function formatBoqNumber(year: number | string, seq: number): string {
  return `BOQ-${year}-${String(seq).padStart(6, '0')}`
}

// --- BOQ pricing math (spec §2-4, §9, §11) ---------------------------------
//
// Unlike every prior phase's extractions (field lists, format functions,
// small state graphs), this section shares real arithmetic: the Selling
// Price / Discount % / Margin % bidirectional calculations, approval-band
// resolution, and BOM-aware cost rollup are pure functions over primitives
// or small per-item shapes — never a full-array traversal over the whole
// in-memory store — so there is no technical reason for `apps/api`'s BOQ
// router to reimplement them a second time, and the migration plan's own
// global constraints forbid it for exactly this kind of "cost rollup"
// algorithm. Frontend call sites (`pricing-levels-logic.ts`,
// `repository-logic.ts`) keep their own existing public function names and
// signatures — they now delegate to these primitives instead of redeclaring
// the arithmetic, so no existing consumer or test changes.

/** Thrown by every validating helper below. Nothing here ever silently
 *  clamps a value the caller didn't ask for. */
export class PricingValidationError extends Error {}

/** Shared tolerance for float round-trips through a discount <-> selling
 *  price conversion (division then its inverse) — e.g. list 85000 / 30% max
 *  lands on a selling price of 59499.999999999993, which recomputes to
 *  30.000000000000014%, not exactly 30. Without this epsilon that noise
 *  reads as "exceeds the maximum" and rejects a value exactly at the limit. */
export const DISCOUNT_FLOAT_EPSILON = 1e-9

/** Discount % is always derived against List Price, never a pricing level's
 *  own tier price. */
export function discountPctForSellingPrice(listPrice: number, sellingPrice: number): number {
  if (listPrice === 0) return 0
  return ((listPrice - sellingPrice) / listPrice) * 100
}

export function sellingPriceForDiscountPct(listPrice: number, discountPct: number): number {
  return listPrice * (1 - discountPct / 100)
}

export interface PricingLevelCap {
  level: string
  maximumDiscountPercent: number
}

/** A `level`'s own `maximumDiscountPercent` if the SKU has enabled that
 *  level — otherwise the SKU-wide fallback used by lines with no active
 *  level. Never a field shared between two different levels. */
export function maxDiscountPercentForLevel(
  sku: { maximumDiscountPercent: number; selectedPricingLevels: PricingLevelCap[] },
  level: string,
): number {
  return sku.selectedPricingLevels.find((s) => s.level === level)?.maximumDiscountPercent ?? sku.maximumDiscountPercent
}

/** True when a line's `unitPrice` is already the final absolute per-unit
 *  charge (an active pricing level with a resolved selling price) rather
 *  than a pre-discount reference price `discountPct` still needs to be
 *  applied to. */
export function isAbsoluteLinePrice(
  pricingLevels: { level: string; sellingPrice: number | null }[],
  activePricingLevel: string | null,
): boolean {
  if (!activePricingLevel) return false
  return pricingLevels.some((l) => l.level === activePricingLevel && l.sellingPrice !== null)
}

/** The unit price actually charged per unit before tax: `unitPrice` itself
 *  when it's already absolute, otherwise `unitPrice` discounted by
 *  `discountPct`. */
export function effectiveUnitPrice(unitPrice: number, discountPct: number, isAbsolutePrice: boolean): number {
  return isAbsolutePrice ? unitPrice : unitPrice * (1 - discountPct / 100)
}

export function computeLineTotal(
  quantity: number, unitPrice: number, discountPct: number, taxPct: number, factorToBoqCurrency: number,
  isAbsolutePrice = false,
): number {
  return quantity * effectiveUnitPrice(unitPrice, discountPct, isAbsolutePrice) * (1 + taxPct / 100) * factorToBoqCurrency
}

/** Quantity must always be >= 1 — rejects 0, negative, fractional-below-1,
 *  and non-finite values alike; never silently coerced into range. */
export function validateLineQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new PricingValidationError('Quantity must be at least 1.')
  }
}

/** Validates `discountPct` against an already-resolved `maxDiscountPercent`
 *  (the caller computes the SKU-wide or per-level cap) — rejects rather than
 *  silently clamping. The epsilon absorbs the same float round-trip
 *  `DISCOUNT_FLOAT_EPSILON` documents. */
export function validateLineDiscountPct(discountPct: number, maxDiscountPercent: number): void {
  if (!Number.isFinite(discountPct) || discountPct < 0) {
    throw new PricingValidationError('Discount % must be a valid, non-negative number.')
  }
  if (discountPct > maxDiscountPercent + DISCOUNT_FLOAT_EPSILON) {
    throw new PricingValidationError(`Discount of ${discountPct}% exceeds this SKU's maximum allowed discount of ${maxDiscountPercent}%.`)
  }
}

/** Finds the discount band whose `minDiscountPct` is the highest one at or
 *  below `discountPct`. Bands are contiguous, so at an exact boundary this
 *  resolves to the stricter band above it, not the auto-approving band
 *  below — a deliberate conservative tie-break. Generic over any band shape
 *  with a `minDiscountPct`, so both the frontend's `ApprovalMatrixRule[]`
 *  and the backend's DB-row shape can share this without a type dependency. */
export function resolveApprovalBand<T extends { minDiscountPct: number }>(bands: T[], discountPct: number): T {
  const sorted = [...bands].sort((a, b) => a.minDiscountPct - b.minDiscountPct)
  let match = sorted[0]
  for (const b of sorted) if (discountPct >= b.minDiscountPct) match = b
  return match
}

/** A copied line (revise/duplicate) starts a new approval lifecycle rather
 *  than carrying over whatever decision was made on the line it was copied
 *  from — recomputed from the current discount via the same approval matrix
 *  a freshly-added line would use. */
export function freshLineApprovalState<T extends { minDiscountPct: number; allowAutoApproval: boolean }>(
  approvalMatrix: T[], discountPct: number,
) {
  const band = resolveApprovalBand(approvalMatrix, discountPct)
  return {
    approvalStatus: band.allowAutoApproval ? ('auto_approved' as const) : ('pending' as const),
    approverId: null, approvalDate: null, approvalRemarks: '',
  }
}

export interface SkuCostFields {
  baseSoftwareCost: number
  implementationCostPerMM: number
  integrationCost: number
  thirdPartyCost: number
  hardwareCost: number
  cloudCost: number
  supportCost: number
  trainingCost: number
}

/** Sum of the 8 cost fields — shared by SKU-level and BOQ-level margin. */
export function skuTotalUnitCost(sku: SkuCostFields): number {
  return sku.baseSoftwareCost + sku.implementationCostPerMM + sku.integrationCost + sku.thirdPartyCost
    + sku.hardwareCost + sku.cloudCost + sku.supportCost + sku.trainingCost
}

/** BOM Option B (cost rollup): a SKU's fully-loaded unit cost is its own
 *  cost fields plus every MANDATORY BOM component's own cost x quantity.
 *  Optional components are excluded. One level deep: a component's own BOM
 *  isn't recursed into. */
export function skuTotalUnitCostWithBom<S extends SkuCostFields & { id: string }>(
  sku: S,
  bomItems: { parentSkuId: string; componentSkuId: string; mandatory: boolean; quantity: number }[],
  skusById: Map<string, S>,
): number {
  const componentCost = bomItems
    .filter((b) => b.parentSkuId === sku.id && b.mandatory)
    .reduce((sum, b) => {
      const component = skusById.get(b.componentSkuId)
      return component ? sum + b.quantity * skuTotalUnitCost(component) : sum
    }, 0)
  return skuTotalUnitCost(sku) + componentCost
}

/** Ratio-of-rates arithmetic underlying currency conversion: multiply an
 *  amount denominated in the `fromRate` currency by this to get the
 *  equivalent amount in the `toRate` currency (both rates relative to the
 *  same base currency). The per-side currency *lookup* (array scan vs. DB
 *  query) stays separate — only this ratio is shared. */
export function conversionFactorFromRates(fromRate: number, toRate: number): number {
  return fromRate / toRate
}

/** Per-line revenue/cost rollup for a BOQ's blended margin %. `revenue` is
 *  pre-tax. `conversionFactorFor` decouples this from any particular
 *  currency-lookup mechanism — the caller resolves each line's SKU's
 *  conversion factor into the BOQ's currency however its side does that
 *  (array scan vs. DB rows already fetched). */
export function computeBoqMarginPercent<
  L extends { skuId: string; quantity: number; unitPrice: number; discountPct: number
    pricingLevels: { level: string; sellingPrice: number | null }[]; activePricingLevel: string | null },
  S extends SkuCostFields & { id: string },
>(
  lines: L[], skusById: Map<string, S>,
  bomItems: { parentSkuId: string; componentSkuId: string; mandatory: boolean; quantity: number }[],
  conversionFactorFor: (sku: S) => number,
): number {
  let revenue = 0
  let cost = 0
  for (const line of lines) {
    const sku = skusById.get(line.skuId)
    if (!sku) continue
    const factor = conversionFactorFor(sku)
    const isAbsolutePrice = isAbsoluteLinePrice(line.pricingLevels, line.activePricingLevel)
    revenue += line.quantity * effectiveUnitPrice(line.unitPrice, line.discountPct, isAbsolutePrice) * factor
    cost += line.quantity * skuTotalUnitCostWithBom(sku, bomItems, skusById) * factor
  }
  return revenue === 0 ? 0 : ((revenue - cost) / revenue) * 100
}

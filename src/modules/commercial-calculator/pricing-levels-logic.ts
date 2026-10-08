import {
  DISCOUNT_FLOAT_EPSILON, PricingValidationError,
  discountPctForSellingPrice as discountPctForSellingPriceCore,
  sellingPriceForDiscountPct as sellingPriceForDiscountPctCore,
  maxDiscountPercentForLevel as maxDiscountPercentForLevelCore,
  isAbsoluteLinePrice as isAbsoluteLinePriceCore,
  effectiveUnitPrice as effectiveUnitPriceCore,
} from '@goms/domain'
import { skuTotalUnitCostWithBom } from './repository-logic'
import { formatPercent } from './format'
import type { CommercialBomItem, CommercialBoqLineItem, CommercialSku, LinePricingLevel, PricingLevelKey } from './types'

export const PRICING_LEVEL_KEYS: PricingLevelKey[] = ['internal', 'floor', 'partner', 'government', 'enterprise', 'corporate']

export const PRICING_LEVEL_LABEL: Record<PricingLevelKey, string> = {
  internal: 'Internal', floor: 'Floor', partner: 'Partner',
  government: 'Government', enterprise: 'Enterprise', corporate: 'Corporate',
}

/** Thrown by every validating helper below — the UI shows `.message` inline
 *  and blocks the save; nothing here ever silently clamps (spec §2).
 *  Re-exported from `@goms/domain` (Phase 6) — the backend BOQ router throws
 *  the same class for the same reason, sharing one identity. */
export { PricingValidationError, DISCOUNT_FLOAT_EPSILON }

/** The SKU's own tier price for a level — a starting hint only, never
 *  auto-filled into the Selling Price input (spec §3: stays empty until the
 *  user types a value). */
export function skuPriceForLevel(sku: CommercialSku, level: PricingLevelKey): number | null {
  switch (level) {
    case 'internal': return sku.internalPrice
    case 'floor': return sku.floorPrice
    case 'partner': return sku.partnerPrice
    case 'government': return sku.governmentPrice
    case 'enterprise': return sku.enterprisePrice
    case 'corporate': return sku.corporatePrice
  }
}

/** Discount % is always derived against List Price, uniformly across every
 *  pricing level (spec §2/§3) — never against that level's own tier price.
 *  Delegates to `@goms/domain` (Phase 6) — the backend BOQ router shares this
 *  exact arithmetic. */
export function discountPctForSellingPrice(listPrice: number, sellingPrice: number): number {
  return discountPctForSellingPriceCore(listPrice, sellingPrice)
}

export function sellingPriceForDiscountPct(listPrice: number, discountPct: number): number {
  return sellingPriceForDiscountPctCore(listPrice, discountPct)
}

/** A `level`'s own `maximumDiscountPercent` (set via the SKU form's "Set
 *  Pricing Levels" section) if the SKU has enabled that level — otherwise
 *  the SKU-wide fallback used by lines with no active level at all. Never a
 *  field shared between two different levels (2026-08-20 UI correction).
 *  Delegates to `@goms/domain` (Phase 6). */
export function maxDiscountPercentForLevel(sku: CommercialSku, level: PricingLevelKey): number {
  return maxDiscountPercentForLevelCore(sku, level)
}

/** Validates a candidate selling price against the applicable maximum
 *  discount — `level`'s own override when the SKU has one, else the SKU's
 *  overall `maximumDiscountPercent` — measured against List Price. Throws
 *  rather than clamping.
 *
 *  The epsilon guards a real floating-point round trip, not a rule change: a
 *  discount typed as exactly the maximum goes through
 *  `sellingPriceForDiscountPct` (a division) to get a selling price, then
 *  back through `discountPctForSellingPrice` (the inverse) here — e.g. list
 *  85000 / 30% max lands on a selling price of 59499.999999999993, which
 *  recomputes to 30.000000000000014%, not exactly 30. Without the epsilon
 *  that noise reads as "exceeds the maximum" and rejects a discount that is
 *  exactly at the limit. */
export function validateSellingPrice(sku: CommercialSku, sellingPrice: number, level?: PricingLevelKey): void {
  const discountPct = discountPctForSellingPrice(sku.listPrice, sellingPrice)
  const maxDiscountPct = level ? maxDiscountPercentForLevel(sku, level) : sku.maximumDiscountPercent
  if (discountPct > maxDiscountPct + DISCOUNT_FLOAT_EPSILON) {
    throw new PricingValidationError(
      `A selling price of ${sellingPrice} implies a ${formatPercent(discountPct)} discount, which exceeds this SKU's maximum allowed discount of ${maxDiscountPct}%.`,
    )
  }
}

export function marginPctForSellingPrice(
  sku: CommercialSku, bomItems: CommercialBomItem[], skusById: Map<string, CommercialSku>, sellingPrice: number,
): number {
  if (sellingPrice === 0) return 0
  const cost = skuTotalUnitCostWithBom(sku, bomItems, skusById)
  return ((sellingPrice - cost) / sellingPrice) * 100
}

/** Margin -> Selling Price (spec §4): `sellingPrice = cost / (1 - margin/100)`.
 *  Validates the back-solved price exactly as a direct Selling Price entry
 *  would be (against `level`'s own maximum discount, when given) — never
 *  silently changes the requested margin. */
export function sellingPriceForMargin(
  sku: CommercialSku, bomItems: CommercialBomItem[], skusById: Map<string, CommercialSku>, marginPct: number,
  level?: PricingLevelKey,
): number {
  if (marginPct >= 100) {
    throw new PricingValidationError('Margin must be below 100%.')
  }
  const cost = skuTotalUnitCostWithBom(sku, bomItems, skusById)
  const sellingPrice = cost / (1 - marginPct / 100)
  validateSellingPrice(sku, sellingPrice, level)
  return sellingPrice
}

/** Adds or updates one level's sellingPrice within a line's pricingLevels
 *  array — never duplicates a level (spec §3). */
export function upsertPricingLevel(levels: LinePricingLevel[], level: PricingLevelKey, sellingPrice: number | null): LinePricingLevel[] {
  return levels.some((l) => l.level === level)
    ? levels.map((l) => (l.level === level ? { ...l, sellingPrice } : l))
    : [...levels, { level, sellingPrice }]
}

export function removePricingLevel(levels: LinePricingLevel[], level: PricingLevelKey): LinePricingLevel[] {
  return levels.filter((l) => l.level !== level)
}

/** True when a line's `unitPrice` is already the final absolute per-unit
 *  charge — an active pricing level with a resolved selling price — rather
 *  than a pre-discount reference price `discountPct` still needs to be
 *  applied to. `discountPct` stays meaningful either way (approval banding,
 *  the "X% off" display), but total/floor-check math must apply it only in
 *  the second case, or an absolute price gets discounted a second time on
 *  top of a value that's already net. Delegates to `@goms/domain` (Phase 6). */
export function isAbsoluteLinePrice(pricingLevels: LinePricingLevel[], activePricingLevel: PricingLevelKey | null): boolean {
  return isAbsoluteLinePriceCore(pricingLevels, activePricingLevel)
}

/** The unit price actually charged per unit before tax: `unitPrice` itself
 *  when it's already absolute (see `isAbsoluteLinePrice`), otherwise
 *  `unitPrice` discounted by `discountPct`. Delegates to `@goms/domain`
 *  (Phase 6) — the backend BOQ router shares this exact arithmetic. */
export function effectiveUnitPrice(unitPrice: number, discountPct: number, isAbsolutePrice: boolean): number {
  return effectiveUnitPriceCore(unitPrice, discountPct, isAbsolutePrice)
}

/** Given a line's pricingLevels + activePricingLevel, resolves the effective
 *  unitPrice/discountPct that feed the existing calculation pipeline
 *  (computeLineTotal, resolveApprovalBand, ...). `currentDiscountPct` is the
 *  line's own already-stored discount — returned unchanged whenever there's
 *  no valid active level, so lines that predate this feature (or that never
 *  touch the Selling Price section) behave exactly as before. */
export function resolveLineUnitPrice(
  sku: CommercialSku, currentDiscountPct: number, pricingLevels: LinePricingLevel[], activePricingLevel: PricingLevelKey | null,
): { unitPrice: number; discountPct: number; isAbsolutePrice: boolean } {
  const active = activePricingLevel ? pricingLevels.find((l) => l.level === activePricingLevel) : undefined
  if (!active || active.sellingPrice === null) {
    return { unitPrice: sku.listPrice, discountPct: currentDiscountPct, isAbsolutePrice: false }
  }
  return {
    unitPrice: active.sellingPrice,
    discountPct: discountPctForSellingPrice(sku.listPrice, active.sellingPrice),
    isAbsolutePrice: true,
  }
}

export interface BulkPricingResult {
  lineId: string
  ok: boolean
  quantity?: number
  unitPrice?: number
  discountPct?: number
  pricingLevels?: LinePricingLevel[]
  activePricingLevel?: PricingLevelKey | null
  error?: string
}

/** The minimal line shape every bulk-edit helper below actually reads —
 *  narrower than the full `CommercialBoqLineItem` so a not-yet-saved line
 *  (e.g. `CreateBoq.tsx`'s in-progress draft lines, which have no `boqId`/
 *  `taxPct`/`lineTotal`/approval fields yet) can be bulk-edited with this
 *  exact same logic instead of a second implementation. A real
 *  `CommercialBoqLineItem` already satisfies this structurally. */
export type BulkEditableLine = Pick<CommercialBoqLineItem, 'id' | 'skuId' | 'discountPct' | 'pricingLevels'>

function bulkApply(
  lines: BulkEditableLine[], skusById: Map<string, CommercialSku>,
  compute: (sku: CommercialSku, line: BulkEditableLine) => Omit<BulkPricingResult, 'lineId' | 'ok'>,
): BulkPricingResult[] {
  return lines.map((line) => {
    const sku = skusById.get(line.skuId)
    if (!sku) return { lineId: line.id, ok: false, error: 'No SKU found for this line.' }
    try {
      return { lineId: line.id, ok: true, ...compute(sku, line) }
    } catch (e) {
      return { lineId: line.id, ok: false, error: e instanceof PricingValidationError ? e.message : 'Could not apply this change.' }
    }
  })
}

export function computeBulkSetDiscount(
  lines: BulkEditableLine[], skusById: Map<string, CommercialSku>, level: PricingLevelKey, discountPct: number,
): BulkPricingResult[] {
  return bulkApply(lines, skusById, (sku, line) => {
    const sellingPrice = sellingPriceForDiscountPct(sku.listPrice, discountPct)
    validateSellingPrice(sku, sellingPrice, level)
    return {
      unitPrice: sellingPrice, discountPct: discountPctForSellingPrice(sku.listPrice, sellingPrice),
      pricingLevels: upsertPricingLevel(line.pricingLevels, level, sellingPrice), activePricingLevel: level,
    }
  })
}

export function computeBulkSetSellingPrice(
  lines: BulkEditableLine[], skusById: Map<string, CommercialSku>, level: PricingLevelKey, sellingPrice: number,
): BulkPricingResult[] {
  return bulkApply(lines, skusById, (sku, line) => {
    validateSellingPrice(sku, sellingPrice, level)
    return {
      unitPrice: sellingPrice, discountPct: discountPctForSellingPrice(sku.listPrice, sellingPrice),
      pricingLevels: upsertPricingLevel(line.pricingLevels, level, sellingPrice), activePricingLevel: level,
    }
  })
}

export function computeBulkClearDiscount(
  lines: BulkEditableLine[], skusById: Map<string, CommercialSku>,
): BulkPricingResult[] {
  return bulkApply(lines, skusById, (sku) => ({ unitPrice: sku.listPrice, discountPct: 0, activePricingLevel: null }))
}

/** Quantity must always be >= 1 (BOQ workbench QA pass) — a fractional
 *  amount like 0.5 is still rejected even though it's "greater than 0". */
export function computeBulkSetQuantity(lines: BulkEditableLine[], quantity: number): BulkPricingResult[] {
  if (!Number.isFinite(quantity) || quantity < 1) {
    return lines.map((line) => ({ lineId: line.id, ok: false, error: 'Quantity must be at least 1.' }))
  }
  return lines.map((line) => ({ lineId: line.id, ok: true, quantity }))
}

/** Switch-only — never adds `level` to a line that doesn't already have it
 *  (BOQ workbench spec §8's approved bulk-edit decision). Lines missing the
 *  level are reported as failures so the caller can list them by SKU,
 *  never silently skipped. */
export function computeBulkSwitchActivePricingLevel(
  lines: BulkEditableLine[], skusById: Map<string, CommercialSku>, level: PricingLevelKey,
): BulkPricingResult[] {
  return lines.map((line) => {
    const sku = skusById.get(line.skuId)
    if (!sku) return { lineId: line.id, ok: false, error: 'No SKU found for this line.' }
    if (!line.pricingLevels.some((l) => l.level === level)) {
      return { lineId: line.id, ok: false, error: `${PRICING_LEVEL_LABEL[level]} is not present on this line.` }
    }
    const { unitPrice, discountPct } = resolveLineUnitPrice(sku, line.discountPct, line.pricingLevels, level)
    return { lineId: line.id, ok: true, unitPrice, discountPct, activePricingLevel: level }
  })
}

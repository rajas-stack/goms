import { skuTotalUnitCostWithBom } from './repository-logic'
import type { CommercialBomItem, CommercialBoqLineItem, CommercialSku, LinePricingLevel, PricingLevelKey } from './types'

export const PRICING_LEVEL_KEYS: PricingLevelKey[] = ['internal', 'floor', 'partner', 'government', 'enterprise', 'corporate']

export const PRICING_LEVEL_LABEL: Record<PricingLevelKey, string> = {
  internal: 'Internal', floor: 'Floor', partner: 'Partner',
  government: 'Government', enterprise: 'Enterprise', corporate: 'Corporate',
}

/** Thrown by every validating helper below — the UI shows `.message` inline
 *  and blocks the save; nothing here ever silently clamps (spec §2). */
export class PricingValidationError extends Error {}

/** The SKU's own tier price for a level — a starting hint only, never
 *  auto-filled into the Selling Price input (spec §3: stays empty until the
 *  user types a value). */
export function skuPriceForLevel(sku: CommercialSku, level: PricingLevelKey): number {
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
 *  pricing level (spec §2/§3) — never against that level's own tier price. */
export function discountPctForSellingPrice(listPrice: number, sellingPrice: number): number {
  if (listPrice === 0) return 0
  return ((listPrice - sellingPrice) / listPrice) * 100
}

export function sellingPriceForDiscountPct(listPrice: number, discountPct: number): number {
  return listPrice * (1 - discountPct / 100)
}

/** Validates a candidate selling price against the SKU's own
 *  `maximumDiscountPercent`, measured against List Price. Throws rather
 *  than clamping. */
export function validateSellingPrice(sku: CommercialSku, sellingPrice: number): void {
  const discountPct = discountPctForSellingPrice(sku.listPrice, sellingPrice)
  if (discountPct > sku.maximumDiscountPercent) {
    throw new PricingValidationError(
      `A selling price of ${sellingPrice} implies a ${discountPct.toFixed(1)}% discount, which exceeds this SKU's maximum allowed discount of ${sku.maximumDiscountPercent}%.`,
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
 *  would be — never silently changes the requested margin. */
export function sellingPriceForMargin(
  sku: CommercialSku, bomItems: CommercialBomItem[], skusById: Map<string, CommercialSku>, marginPct: number,
): number {
  if (marginPct >= 100) {
    throw new PricingValidationError('Margin must be below 100%.')
  }
  const cost = skuTotalUnitCostWithBom(sku, bomItems, skusById)
  const sellingPrice = cost / (1 - marginPct / 100)
  validateSellingPrice(sku, sellingPrice)
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

/** Given a line's pricingLevels + activePricingLevel, resolves the effective
 *  unitPrice/discountPct that feed the existing calculation pipeline
 *  (computeLineTotal, resolveApprovalBand, ...). `currentDiscountPct` is the
 *  line's own already-stored discount — returned unchanged whenever there's
 *  no valid active level, so lines that predate this feature (or that never
 *  touch the Selling Price section) behave exactly as before. */
export function resolveLineUnitPrice(
  sku: CommercialSku, currentDiscountPct: number, pricingLevels: LinePricingLevel[], activePricingLevel: PricingLevelKey | null,
): { unitPrice: number; discountPct: number } {
  const active = activePricingLevel ? pricingLevels.find((l) => l.level === activePricingLevel) : undefined
  if (!active || active.sellingPrice === null) {
    return { unitPrice: sku.listPrice, discountPct: currentDiscountPct }
  }
  return { unitPrice: active.sellingPrice, discountPct: discountPctForSellingPrice(sku.listPrice, active.sellingPrice) }
}

export interface BulkPricingResult {
  lineId: string
  ok: boolean
  unitPrice?: number
  discountPct?: number
  pricingLevels?: LinePricingLevel[]
  activePricingLevel?: PricingLevelKey | null
  error?: string
}

function bulkApply(
  lines: CommercialBoqLineItem[], skusById: Map<string, CommercialSku>,
  compute: (sku: CommercialSku, line: CommercialBoqLineItem) => Omit<BulkPricingResult, 'lineId' | 'ok'>,
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
  lines: CommercialBoqLineItem[], skusById: Map<string, CommercialSku>, level: PricingLevelKey, discountPct: number,
): BulkPricingResult[] {
  return bulkApply(lines, skusById, (sku, line) => {
    const sellingPrice = sellingPriceForDiscountPct(sku.listPrice, discountPct)
    validateSellingPrice(sku, sellingPrice)
    return {
      unitPrice: sellingPrice, discountPct: discountPctForSellingPrice(sku.listPrice, sellingPrice),
      pricingLevels: upsertPricingLevel(line.pricingLevels, level, sellingPrice), activePricingLevel: level,
    }
  })
}

export function computeBulkSetSellingPrice(
  lines: CommercialBoqLineItem[], skusById: Map<string, CommercialSku>, level: PricingLevelKey, sellingPrice: number,
): BulkPricingResult[] {
  return bulkApply(lines, skusById, (sku, line) => {
    validateSellingPrice(sku, sellingPrice)
    return {
      unitPrice: sellingPrice, discountPct: discountPctForSellingPrice(sku.listPrice, sellingPrice),
      pricingLevels: upsertPricingLevel(line.pricingLevels, level, sellingPrice), activePricingLevel: level,
    }
  })
}

export function computeBulkClearDiscount(
  lines: CommercialBoqLineItem[], skusById: Map<string, CommercialSku>,
): BulkPricingResult[] {
  return bulkApply(lines, skusById, (sku) => ({ unitPrice: sku.listPrice, discountPct: 0, activePricingLevel: null }))
}

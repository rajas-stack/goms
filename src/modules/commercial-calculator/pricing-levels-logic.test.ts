import { describe, expect, it } from 'vitest'
import {
  PricingValidationError, computeBulkClearDiscount, computeBulkSetDiscount, computeBulkSetQuantity,
  computeBulkSetSellingPrice, computeBulkSwitchActivePricingLevel,
  discountPctForSellingPrice, effectiveUnitPrice, isAbsoluteLinePrice, marginPctForSellingPrice,
  maxDiscountPercentForLevel, removePricingLevel,
  resolveLineUnitPrice, sellingPriceForDiscountPct, sellingPriceForMargin, skuPriceForLevel, upsertPricingLevel,
  validateSellingPrice,
} from './pricing-levels-logic'
import type { CommercialBoqLineItem, CommercialSku } from './types'

function sku(overrides: Partial<CommercialSku> = {}): CommercialSku {
  return {
    id: 's1', skuCode: 'X', name: 'X', categoryId: '', featureId: '', editionId: '', uomId: '', currencyId: '',
    taxClassId: '', billingTypeId: '', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active',
    isSellable: true, displayOrder: 0,
    baseSoftwareCost: 400, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 900, floorPrice: 800, partnerPrice: 950, governmentPrice: 850,
    enterprisePrice: 1100, corporatePrice: 1050, listPrice: 1000,
    minimumAllowedPrice: 500, maximumDiscountPercent: 30, selectedPricingLevels: [],
    createdAt: '', createdBy: null,
    ...overrides,
  }
}

describe('discountPctForSellingPrice / sellingPriceForDiscountPct', () => {
  it('derives discount % against list price', () => {
    expect(discountPctForSellingPrice(1000, 800)).toBeCloseTo(20, 5)
  })
  it('round-trips', () => {
    expect(sellingPriceForDiscountPct(1000, 20)).toBeCloseTo(800, 5)
  })
  it('returns 0 for a zero list price rather than dividing by zero', () => {
    expect(discountPctForSellingPrice(0, 0)).toBe(0)
  })
})

describe('validateSellingPrice', () => {
  it('accepts a selling price within maximumDiscountPercent', () => {
    expect(() => validateSellingPrice(sku(), 750)).not.toThrow() // 25% off, max is 30%
  })
  it('rejects (never clamps) a selling price beyond maximumDiscountPercent', () => {
    expect(() => validateSellingPrice(sku(), 600)).toThrow(PricingValidationError) // 40% off
  })
  it('accepts a discount typed as exactly the maximum, despite float noise in the round trip through sellingPriceForDiscountPct', () => {
    // 85000 * 0.7 = 59499.999999999993 in IEEE754, which recomputes to a
    // discount fractionally over 30% — this used to be spuriously rejected.
    const bigSku = sku({ listPrice: 85000, maximumDiscountPercent: 30 })
    const sellingPrice = sellingPriceForDiscountPct(bigSku.listPrice, 30)
    expect(() => validateSellingPrice(bigSku, sellingPrice)).not.toThrow()
  })
})

describe('maxDiscountPercentForLevel / per-level maximum discount', () => {
  it('falls back to the SKU-wide maximumDiscountPercent when the level has no override', () => {
    expect(maxDiscountPercentForLevel(sku(), 'internal')).toBe(30)
  })

  it('uses a level-specific override independently of the SKU-wide value and of other levels', () => {
    const withLevels = sku({
      selectedPricingLevels: [
        { level: 'internal', maximumDiscountPercent: 10 },
        { level: 'government', maximumDiscountPercent: 45 },
      ],
    })
    expect(maxDiscountPercentForLevel(withLevels, 'internal')).toBe(10)
    expect(maxDiscountPercentForLevel(withLevels, 'government')).toBe(45)
    // A level with no override still falls back to the SKU-wide value.
    expect(maxDiscountPercentForLevel(withLevels, 'floor')).toBe(30)
  })

  it('validateSellingPrice enforces the level-specific override, not the SKU-wide value', () => {
    const withLevels = sku({ selectedPricingLevels: [{ level: 'internal', maximumDiscountPercent: 10 }] })
    // 25% off list — within the SKU-wide 30% but beyond Internal's own 10%.
    expect(() => validateSellingPrice(withLevels, 750)).not.toThrow()
    expect(() => validateSellingPrice(withLevels, 750, 'internal')).toThrow(PricingValidationError)
  })

  it('sellingPriceForMargin enforces the level-specific override', () => {
    const withLevels = sku({ selectedPricingLevels: [{ level: 'internal', maximumDiscountPercent: 10 }] })
    // cost 400, margin 50% -> price 800 (20% off list) — within SKU-wide 30% but beyond Internal's 10%.
    expect(() => sellingPriceForMargin(withLevels, [], new Map(), 50)).not.toThrow()
    expect(() => sellingPriceForMargin(withLevels, [], new Map(), 50, 'internal')).toThrow(PricingValidationError)
  })
})

describe('skuPriceForLevel', () => {
  it('maps each pricing level to its SKU tier price', () => {
    expect(skuPriceForLevel(sku(), 'government')).toBe(850)
    expect(skuPriceForLevel(sku(), 'enterprise')).toBe(1100)
  })
})

describe('margin <-> selling price', () => {
  it('computes margin % from selling price and cost', () => {
    // cost = 400, sellingPrice = 800 -> margin = (800-400)/800 = 50%
    expect(marginPctForSellingPrice(sku(), [], new Map(), 800)).toBeCloseTo(50, 5)
  })
  it('back-solves selling price from a target margin', () => {
    // cost = 400, margin 50% -> sellingPrice = 400 / 0.5 = 800 (20% off list, within 30% max)
    expect(sellingPriceForMargin(sku(), [], new Map(), 50)).toBeCloseTo(800, 5)
  })
  it('rejects a margin whose back-solved price exceeds maximumDiscountPercent', () => {
    // cost 400, margin 75% -> price 1600 > listPrice, i.e. a negative implied discount is fine,
    // so use a margin that forces a price BELOW the allowed floor instead: margin 20% -> price 500,
    // discount = 50% > max 30%.
    expect(() => sellingPriceForMargin(sku(), [], new Map(), 20)).toThrow(PricingValidationError)
  })
  it('rejects a margin of 100% or more', () => {
    expect(() => sellingPriceForMargin(sku(), [], new Map(), 100)).toThrow(PricingValidationError)
  })
})

describe('upsertPricingLevel / removePricingLevel', () => {
  it('adds a new level', () => {
    const levels = upsertPricingLevel([], 'internal', null)
    expect(levels).toEqual([{ level: 'internal', sellingPrice: null }])
  })
  it('updates an existing level in place rather than duplicating it', () => {
    const levels = upsertPricingLevel([{ level: 'internal', sellingPrice: null }], 'internal', 900)
    expect(levels).toEqual([{ level: 'internal', sellingPrice: 900 }])
  })
  it('removes a level', () => {
    const levels = removePricingLevel([{ level: 'internal', sellingPrice: 900 }, { level: 'floor', sellingPrice: 800 }], 'internal')
    expect(levels).toEqual([{ level: 'floor', sellingPrice: 800 }])
  })
})

describe('resolveLineUnitPrice', () => {
  it('falls back to the line\'s own current discount when no level is active (legacy/plain lines)', () => {
    expect(resolveLineUnitPrice(sku(), 15, [], null)).toEqual({ unitPrice: 1000, discountPct: 15, isAbsolutePrice: false })
  })
  it('uses the active level\'s selling price and derives discount against list price', () => {
    const levels = [{ level: 'government' as const, sellingPrice: 850 }]
    expect(resolveLineUnitPrice(sku(), 0, levels, 'government')).toEqual({ unitPrice: 850, discountPct: 15, isAbsolutePrice: true })
  })
  it('falls back to the current discount if the active level has no price yet', () => {
    const levels = [{ level: 'government' as const, sellingPrice: null }]
    expect(resolveLineUnitPrice(sku(), 5, levels, 'government')).toEqual({ unitPrice: 1000, discountPct: 5, isAbsolutePrice: false })
  })
})

describe('isAbsoluteLinePrice / effectiveUnitPrice', () => {
  it('is false with no active level, true with a resolved one', () => {
    const levels = [{ level: 'government' as const, sellingPrice: 850 }]
    expect(isAbsoluteLinePrice([], null)).toBe(false)
    expect(isAbsoluteLinePrice(levels, null)).toBe(false)
    expect(isAbsoluteLinePrice(levels, 'government')).toBe(true)
    expect(isAbsoluteLinePrice([{ level: 'government', sellingPrice: null }], 'government')).toBe(false)
  })

  it('does not re-apply discountPct on top of an already-absolute price (regression: was double-discounting)', () => {
    // A pricing-level line's unitPrice (850) IS the final per-unit charge —
    // discountPct (15%, derived only for display/banding) must not be
    // subtracted again, or the effective price would wrongly become 722.5.
    expect(effectiveUnitPrice(850, 15, true)).toBe(850)
    // The classic (no active level) path still applies discountPct as before.
    expect(effectiveUnitPrice(1000, 15, false)).toBeCloseTo(850, 5)
  })
})

function line(overrides: Partial<CommercialBoqLineItem> = {}): CommercialBoqLineItem {
  return {
    id: 'l1', boqId: 'b1', skuId: 's1', quantity: 1, unitPrice: 1000, discountPct: 0, taxPct: 18,
    approverId: null, approvalDate: null, approvalRemarks: '', approvalStatus: 'auto_approved', lineTotal: 1180,
    pricingLevels: [], activePricingLevel: null,
    ...overrides,
  }
}

describe('bulk pricing actions', () => {
  it('computeBulkSetDiscount sets the chosen level active on every selected line', () => {
    const skusById = new Map([['s1', sku()]])
    const [result] = computeBulkSetDiscount([line()], skusById, 'internal', 20)
    expect(result.ok).toBe(true)
    expect(result.unitPrice).toBeCloseTo(800, 5)
    expect(result.discountPct).toBeCloseTo(20, 5)
    expect(result.activePricingLevel).toBe('internal')
    expect(result.pricingLevels).toEqual([{ level: 'internal', sellingPrice: 800 }])
  })

  it('computeBulkSetDiscount updates an existing level in place rather than duplicating it', () => {
    const skusById = new Map([['s1', sku()]])
    const existing = line({ pricingLevels: [{ level: 'internal', sellingPrice: 900 }], activePricingLevel: 'internal' })
    const [result] = computeBulkSetDiscount([existing], skusById, 'internal', 10)
    expect(result.pricingLevels).toEqual([{ level: 'internal', sellingPrice: 900 }])
  })

  it('computeBulkSetDiscount reports (does not throw for) a line that would exceed maximumDiscountPercent', () => {
    const skusById = new Map([['s1', sku()]]) // max 30%
    const [result] = computeBulkSetDiscount([line()], skusById, 'internal', 50)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/maximum allowed discount/i)
  })

  it('computeBulkSetSellingPrice validates the same way', () => {
    const skusById = new Map([['s1', sku()]])
    const [result] = computeBulkSetSellingPrice([line()], skusById, 'government', 850)
    expect(result.ok).toBe(true)
    expect(result.activePricingLevel).toBe('government')
  })

  it('computeBulkClearDiscount resets to List Price / no active level', () => {
    const skusById = new Map([['s1', sku()]])
    const existing = line({ pricingLevels: [{ level: 'internal', sellingPrice: 900 }], activePricingLevel: 'internal', discountPct: 10 })
    const [result] = computeBulkClearDiscount([existing], skusById)
    expect(result.ok).toBe(true)
    expect(result.unitPrice).toBe(1000)
    expect(result.discountPct).toBe(0)
    expect(result.activePricingLevel).toBeNull()
  })

  it('reports a line whose SKU cannot be found', () => {
    const [result] = computeBulkSetDiscount([line({ skuId: 'missing' })], new Map(), 'internal', 10)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/sku/i)
  })
})

describe('computeBulkSetQuantity', () => {
  it('sets the same quantity on every line', () => {
    const results = computeBulkSetQuantity([line({ id: 'l1' }), line({ id: 'l2' })], 5)
    expect(results).toEqual([
      { lineId: 'l1', ok: true, quantity: 5 },
      { lineId: 'l2', ok: true, quantity: 5 },
    ])
  })

  it('reports every line as failed for a quantity below 1, without throwing', () => {
    const results = computeBulkSetQuantity([line({ id: 'l1' })], 0)
    expect(results).toEqual([{ lineId: 'l1', ok: false, error: expect.stringMatching(/at least 1/i) }])
    const fractional = computeBulkSetQuantity([line({ id: 'l1' })], 0.5)
    expect(fractional[0].ok).toBe(false)
  })
})

describe('computeBulkSwitchActivePricingLevel', () => {
  it('switches the active level and resolves unit price/discount from it, for lines that already have that level', () => {
    const skusById = new Map([['s1', sku()]])
    const withLevel = line({ id: 'l1', pricingLevels: [{ level: 'government', sellingPrice: 850 }] })
    const [result] = computeBulkSwitchActivePricingLevel([withLevel], skusById, 'government')
    expect(result).toEqual({ lineId: 'l1', ok: true, activePricingLevel: 'government', unitPrice: 850, discountPct: expect.closeTo(15, 5) })
  })

  it('reports, rather than silently skipping, a line that does not have the chosen level', () => {
    const skusById = new Map([['s1', sku()]])
    const withoutLevel = line({ id: 'l1', pricingLevels: [] })
    const [result] = computeBulkSwitchActivePricingLevel([withoutLevel], skusById, 'government')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/government.*not present/i)
  })
})

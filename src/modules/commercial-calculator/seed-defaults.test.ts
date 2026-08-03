import { describe, expect, it } from 'vitest'
import { buildDefaultCommercialCalculatorData } from './seed-defaults'

describe('buildDefaultCommercialCalculatorData', () => {
  it('seeds the 12 PCS-016 SKU categories with unique codes', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(masters.skuCategories).toHaveLength(12)
    expect(new Set(masters.skuCategories.map((c) => c.code)).size).toBe(12)
  })

  it('seeds exactly one base currency', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(masters.currencies.filter((c) => c.isBaseCurrency)).toHaveLength(1)
    expect(masters.currencies.find((c) => c.isBaseCurrency)?.code).toBe('INR')
  })

  it('seeds a Standard edition with a stable, well-known id', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    const std = masters.productEditions.find((e) => e.id === 'ped_standard')
    expect(std).toBeDefined()
    expect(std?.code).toBe('STD')
    expect(std?.active).toBe(true)
  })

  it('seeds an approval matrix with contiguous, gap-free bands from 0 to 90', () => {
    const bands = [...buildDefaultCommercialCalculatorData().masters.approvalMatrix].sort((a, b) => a.minDiscountPct - b.minDiscountPct)
    expect(bands[0].minDiscountPct).toBe(0)
    expect(bands[bands.length - 1].maxDiscountPct).toBe(90)
    for (let i = 0; i < bands.length - 1; i++) {
      expect(bands[i].maxDiscountPct).toBe(bands[i + 1].minDiscountPct)
    }
  })

  it('seeds the lowest approval band as auto-approving, the rest as not', () => {
    const bands = buildDefaultCommercialCalculatorData().masters.approvalMatrix
    expect(bands.find((b) => b.minDiscountPct === 0)?.allowAutoApproval).toBe(true)
    expect(bands.filter((b) => b.minDiscountPct > 0).every((b) => !b.allowAutoApproval)).toBe(true)
  })

  it('leaves the hierarchy masters and Pre-Sales empty for admin population', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(masters.verticals).toEqual([])
    expect(masters.products).toEqual([])
    expect(masters.modules).toEqual([])
    expect(masters.features).toEqual([])
    expect(masters.preSales).toEqual([])
  })

  it('starts with no product-edition/feature mappings', () => {
    expect(buildDefaultCommercialCalculatorData().productEditionFeatures).toEqual([])
  })

  it('returns a fresh object each call, not a shared reference', () => {
    const a = buildDefaultCommercialCalculatorData()
    const b = buildDefaultCommercialCalculatorData()
    a.masters.currencies.push({ ...a.masters.currencies[0], id: 'mutated' })
    expect(b.masters.currencies).toHaveLength(4)
  })
})

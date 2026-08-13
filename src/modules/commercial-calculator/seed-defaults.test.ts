import { describe, expect, it } from 'vitest'
import { WORK_VERTICALS } from '@/features/nodes/department-meta'
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

  it('seeds sample Modules/Features under valid Products, and some Pre-Sales — placeholder data so Create BOQ has something to exercise end-to-end, not an AMNEX reference list like Products', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(masters.modules.length).toBeGreaterThan(0)
    expect(masters.features.length).toBeGreaterThan(0)
    expect(masters.preSales.length).toBeGreaterThan(0)
    const productIds = new Set(masters.products.map((p) => p.id))
    for (const m of masters.modules) expect(productIds.has(m.productId), m.name).toBe(true)
    const moduleIds = new Set(masters.modules.map((m) => m.id))
    for (const f of masters.features) expect(moduleIds.has(f.moduleId), f.name).toBe(true)
  })

  it('seeds Verticals from Account Mapping\'s own WORK_VERTICALS list, not left empty', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(masters.verticals).toHaveLength(WORK_VERTICALS.length)
    expect(masters.verticals.map((v) => v.name)).toEqual(WORK_VERTICALS)
    expect(new Set(masters.verticals.map((v) => v.code)).size).toBe(WORK_VERTICALS.length)
  })

  it('seeds Products under a real Vertical, with unique codes and valid FKs', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(masters.products.length).toBeGreaterThan(0)
    const verticalIds = new Set(masters.verticals.map((v) => v.id))
    for (const p of masters.products) expect(verticalIds.has(p.verticalId), p.name).toBe(true)
    expect(new Set(masters.products.map((p) => p.code)).size).toBe(masters.products.length)
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

import { describe, expect, it } from 'vitest'
import { buildDefaultCommercialCalculatorData } from './seed-defaults'
import { enforceSingleBaseCurrency, findMasterChildren, validateMasterCode, validateParentExists } from './master-rules'
import type { Currency } from './types'

describe('validateMasterCode', () => {
  it('rejects an empty code', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(validateMasterCode(masters, 'skuCategories', '  ', null)).toMatch(/required/i)
  })

  it('rejects a code already used by another row, case-insensitively', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(validateMasterCode(masters, 'skuCategories', 'sw', null)).toMatch(/already used/i)
  })

  it('allows a row to keep its own code when updating (excludeId)', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    const existing = masters.skuCategories[0]
    expect(validateMasterCode(masters, 'skuCategories', existing.code, existing.id)).toBeNull()
  })

  it('allows a genuinely new code', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(validateMasterCode(masters, 'skuCategories', 'BRAND-NEW', null)).toBeNull()
  })
})

describe('validateParentExists', () => {
  it('requires no parent for a master with none configured', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(validateParentExists(masters, 'verticals', {})).toBeNull()
  })

  it('rejects a missing verticalId on products', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(validateParentExists(masters, 'products', {})).toMatch(/verticalId is required/i)
  })

  it('rejects a verticalId that does not exist', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(validateParentExists(masters, 'products', { verticalId: 'nope' })).toMatch(/no such verticals row/i)
  })

  it('accepts a verticalId that exists', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    masters.verticals.push({ id: 'v1', code: 'GOV', name: 'Government', description: '', active: true, displayOrder: 0 })
    expect(validateParentExists(masters, 'products', { verticalId: 'v1' })).toBeNull()
  })
})

describe('findMasterChildren', () => {
  it('finds products under a vertical', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    masters.verticals.push({ id: 'v1', code: 'GOV', name: 'Government', description: '', active: true, displayOrder: 0 })
    masters.products.push({ id: 'p1', code: 'GOMS', name: 'GOMS', description: '', active: true, displayOrder: 0, verticalId: 'v1' })
    expect(findMasterChildren(masters, 'verticals', 'v1')).toHaveLength(1)
    expect(findMasterChildren(masters, 'verticals', 'v-does-not-exist')).toHaveLength(0)
  })

  it('returns an empty list for a leaf master with no children concept', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(findMasterChildren(masters, 'features', 'anything')).toEqual([])
  })
})

describe('enforceSingleBaseCurrency', () => {
  it('clears isBaseCurrency on every row except the winner', () => {
    const rows: Currency[] = buildDefaultCommercialCalculatorData().masters.currencies
    enforceSingleBaseCurrency(rows, 'cur_usd')
    expect(rows.find((r) => r.id === 'cur_usd')?.isBaseCurrency).toBe(true)
    expect(rows.filter((r) => r.isBaseCurrency)).toHaveLength(1)
    expect(rows.find((r) => r.id === 'cur_inr')?.isBaseCurrency).toBe(false)
  })
})

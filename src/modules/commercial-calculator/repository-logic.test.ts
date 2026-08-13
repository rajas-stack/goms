import { describe, expect, it } from 'vitest'
import { buildDefaultCommercialCalculatorData } from './seed-defaults'
import {
  createMasterLogic, deleteMasterLogic, getMasterLogic, listMasterLogic, setMasterActiveLogic, updateMasterLogic,
} from './repository-logic'

describe('listMasterLogic / getMasterLogic', () => {
  it('lists rows sorted by displayOrder', () => {
    const data = buildDefaultCommercialCalculatorData()
    const rows = listMasterLogic(data, 'skuCategories')
    expect(rows).toHaveLength(12)
    expect(rows[0].displayOrder).toBeLessThanOrEqual(rows[1].displayOrder)
  })

  it('gets a row by id, or null if missing', () => {
    const data = buildDefaultCommercialCalculatorData()
    expect(getMasterLogic(data, 'productEditions', 'ped_standard')?.code).toBe('STD')
    expect(getMasterLogic(data, 'productEditions', 'nope')).toBeNull()
  })
})

describe('createMasterLogic', () => {
  // preSales (unlike verticals, seeded from Account Mapping's WORK_VERTICALS
  // list) starts genuinely empty, so appended displayOrder is 0 here.
  it('creates a new master row with a generated id and appended displayOrder', () => {
    const data = buildDefaultCommercialCalculatorData()
    const seededCount = data.masters.preSales.length
    const row = createMasterLogic(data, 'preSales', { code: 'JS', name: 'Jane Smith', description: '' })
    expect(row.id).toMatch(/^mst_/)
    expect(row.active).toBe(true)
    expect(row.displayOrder).toBe(seededCount)
    expect(data.masters.preSales).toHaveLength(seededCount + 1)
  })

  it('appends a new vertical after the seeded Account Mapping verticals', () => {
    const data = buildDefaultCommercialCalculatorData()
    const seededCount = data.masters.verticals.length
    const row = createMasterLogic(data, 'verticals', { code: 'GOV', name: 'Government', description: '' })
    expect(row.displayOrder).toBe(seededCount)
    expect(data.masters.verticals).toHaveLength(seededCount + 1)
  })

  it('rejects a duplicate code', () => {
    const data = buildDefaultCommercialCalculatorData()
    createMasterLogic(data, 'verticals', { code: 'GOV', name: 'Government', description: '' })
    expect(() => createMasterLogic(data, 'verticals', { code: 'gov', name: 'Gov 2', description: '' })).toThrow(/already used/i)
  })

  it('rejects a product with no verticalId', () => {
    const data = buildDefaultCommercialCalculatorData()
    expect(() => createMasterLogic(data, 'products', { code: 'GOMS', name: 'GOMS', description: '', verticalId: '' } as never))
      .toThrow(/required/i)
  })

  it('enforces single base currency on create', () => {
    const data = buildDefaultCommercialCalculatorData()
    const row = createMasterLogic(data, 'currencies', {
      code: 'AED', name: 'UAE Dirham', description: '', symbol: 'د.إ', decimalPlaces: 2, exchangeRate: 22.6, isBaseCurrency: true,
    })
    expect(data.masters.currencies.filter((c) => c.isBaseCurrency)).toEqual([row])
  })
})

describe('updateMasterLogic', () => {
  it('updates fields in place and returns the row', () => {
    const data = buildDefaultCommercialCalculatorData()
    const updated = updateMasterLogic(data, 'productEditions', 'ped_standard', { description: 'Updated' })
    expect(updated.description).toBe('Updated')
  })

  it('throws for a missing id', () => {
    const data = buildDefaultCommercialCalculatorData()
    expect(() => updateMasterLogic(data, 'productEditions', 'nope', { description: 'x' })).toThrow(/no such/i)
  })

  it('re-validates code uniqueness on update, excluding itself', () => {
    const data = buildDefaultCommercialCalculatorData()
    expect(() => updateMasterLogic(data, 'productEditions', 'ped_standard', { code: 'PRO' })).toThrow(/already used/i)
    expect(updateMasterLogic(data, 'productEditions', 'ped_standard', { code: 'STD' }).code).toBe('STD')
  })
})

describe('setMasterActiveLogic / deleteMasterLogic', () => {
  it('toggles active', () => {
    const data = buildDefaultCommercialCalculatorData()
    setMasterActiveLogic(data, 'productEditions', 'ped_standard', false)
    expect(getMasterLogic(data, 'productEditions', 'ped_standard')?.active).toBe(false)
  })

  it('deletes a childless row', () => {
    const data = buildDefaultCommercialCalculatorData()
    deleteMasterLogic(data, 'productEditions', 'ped_standard')
    expect(getMasterLogic(data, 'productEditions', 'ped_standard')).toBeNull()
  })

  it('blocks deleting a vertical that still has products', () => {
    const data = buildDefaultCommercialCalculatorData()
    const vertical = createMasterLogic(data, 'verticals', { code: 'GOV', name: 'Government', description: '' })
    createMasterLogic(data, 'products', { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id })
    expect(() => deleteMasterLogic(data, 'verticals', vertical.id)).toThrow(/still reference it/i)
  })
})

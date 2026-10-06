import { describe, expect, it } from 'vitest'
import { SKU_COST_FIELDS } from '../commercial.js'
import { MASKED_ATOM_FIELDS, SKU_FLOOR_FIELDS, canReadAtom, maskAuditEntry, maskSkuRow, redactSalesPerson } from './mask.js'

const sku = {
  id: 's1', name: 'Core', listPrice: 100, partnerPrice: 90, floorPrice: 70, minimumAllowedPrice: 65, internalPrice: 60,
  baseSoftwareCost: 11, implementationCostPerMM: 12, integrationCost: 13, thirdPartyCost: 14,
  hardwareCost: 15, cloudCost: 16, supportCost: 17, trainingCost: 18,
}

describe('SKU read masking', () => {
  it('declares the 8 cost fields and the 3 floor fields as restricted', () => {
    expect(MASKED_ATOM_FIELDS['sku.costs']).toEqual(SKU_COST_FIELDS)
    expect([...SKU_FLOOR_FIELDS]).toEqual(['floorPrice', 'minimumAllowedPrice', 'internalPrice'])
  })
  it('lets only Pre-sales, Finance and CXO read costs and floor prices', () => {
    for (const role of ['presales', 'finance', 'cxo'] as const) {
      expect(canReadAtom([role], 'sku.costs')).toBe(true)
      expect(canReadAtom([role], 'sku.floor')).toBe(true)
    }
    for (const role of ['sales', 'bid', 'legal', 'delivery', 'it'] as const) expect(canReadAtom([role], 'sku.costs')).toBe(false)
    expect(canReadAtom([], 'sku.costs')).toBe(false)
    expect(canReadAtom(['sales', 'finance'], 'sku.costs')).toBe(true) // any one authorised role is enough
  })
  it('nulls masked fields (never 0) and lists them, leaving public price fields intact', () => {
    const masked = maskSkuRow(sku, ['sales'])
    for (const f of [...SKU_COST_FIELDS, ...SKU_FLOOR_FIELDS]) expect((masked as any)[f]).toBeNull()
    expect(masked.listPrice).toBe(100)
    expect(masked.partnerPrice).toBe(90)
    expect([...masked.maskedFields].sort()).toEqual([...SKU_COST_FIELDS, ...SKU_FLOOR_FIELDS].sort())
  })
  it('returns the row untouched for an authorised role, with an empty maskedFields list', () => {
    const out = maskSkuRow(sku, ['presales'])
    expect(out).toMatchObject(sku)
    expect(out.maskedFields).toEqual([])
  })
})

describe('audit masking', () => {
  const entry = { entityType: 'sku', field: 'hardwareCost', oldValue: '15', newValue: '99', reason: 'r' }
  it('blanks old/new values of a restricted SKU field for an unauthorised role', () => {
    expect(maskAuditEntry(entry, ['bid'])).toMatchObject({ field: 'hardwareCost', oldValue: '', newValue: '', masked: true })
  })
  it('leaves other fields, other entities and authorised roles alone', () => {
    expect(maskAuditEntry({ ...entry, field: 'listPrice' }, ['bid'])).toMatchObject({ oldValue: '15', newValue: '99' })
    expect(maskAuditEntry({ ...entry, entityType: 'boq' }, ['bid'])).toMatchObject({ oldValue: '15' })
    expect(maskAuditEntry(entry, ['finance'])).toMatchObject({ oldValue: '15', newValue: '99' })
  })
})

describe('sales person redaction', () => {
  it('keeps what row screens need and drops personal data', () => {
    const person = { id: 'p', name: 'A', officialEmail: 'a@amnex.com', photoUrl: 'u', status: 'active', personalEmail: 'x@y', mobile: '1', altMobile: '2', notes: 'n', metadata: { a: '1' }, employeeCode: 'E1', joinedOn: '2020-01-01', leftOn: null }
    expect(redactSalesPerson(person)).toEqual({
      id: 'p', name: 'A', officialEmail: 'a@amnex.com', photoUrl: 'u', status: 'active',
      personalEmail: '', mobile: '', altMobile: '', notes: '', metadata: {}, employeeCode: '', joinedOn: null, leftOn: null,
    })
  })
})

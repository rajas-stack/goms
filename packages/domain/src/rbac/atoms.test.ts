import { describe, expect, it } from 'vitest'
import {
  BID_PATCH_ATOMS, IGNORED_PATCH_KEYS, OPPORTUNITY_PATCH_ATOMS, atomsForPatch, lineItemPatchAtom, masterKeyAtom,
  salesPersonPatchAtom, skuPatchAtom,
} from './atoms.js'

const opp = (k: string) => (IGNORED_PATCH_KEYS.has(k) ? undefined : OPPORTUNITY_PATCH_ATOMS[k] ?? null)

describe('atomsForPatch', () => {
  it('maps every opportunity patch key to its atom and de-duplicates', () => {
    expect(atomsForPatch({ opportunityName: 'x', city: 'Pune', vertical: 'IT', valueAmount: '1' }, opp)!.sort())
      .toEqual(['opp.client', 'opp.identity', 'opp.value'])
  })
  it('ignores the echoed opportunityCode', () => {
    expect(atomsForPatch({ opportunityCode: 'OPP-1', city: 'x' }, opp)).toEqual(['opp.client'])
  })
  it('returns null for a key with no atom (fail closed) and for a non-object patch', () => {
    expect(atomsForPatch({ city: 'x', typoField: 1 }, opp)).toBeNull()
    expect(atomsForPatch(undefined, opp)).toBeNull()
    expect(atomsForPatch([], opp)).toBeNull()
    expect(atomsForPatch('x', opp)).toBeNull()
  })
  it('returns [] for an empty patch', () => {
    expect(atomsForPatch({}, opp)).toEqual([])
  })
})

describe('atom maps', () => {
  it('bid patch keys', () => {
    expect(BID_PATCH_ATOMS).toEqual({ stageKey: 'bid.stage', decision: 'bid.decision', tenderLink: 'opp.identity', sheet: 'bid.move' })
  })
  it('classifies SKU patch keys into costs / floor / tax / other', () => {
    expect(skuPatchAtom('hardwareCost')).toBe('sku.costs')
    expect(skuPatchAtom('floorPrice')).toBe('sku.floor')
    expect(skuPatchAtom('minimumAllowedPrice')).toBe('sku.floor')
    expect(skuPatchAtom('internalPrice')).toBe('sku.floor')
    expect(skuPatchAtom('taxClassId')).toBe('sku.tax')
    expect(skuPatchAtom('listPrice')).toBe('sku.other')
    expect(skuPatchAtom('name')).toBe('sku.other')
  })
  it('classifies master keys and BOQ line-item patch keys', () => {
    expect(masterKeyAtom('taxClasses')).toBe('master.taxClasses')
    expect(masterKeyAtom('currencies')).toBe('master.currencies')
    expect(masterKeyAtom('verticals')).toBe('master.other')
    expect(lineItemPatchAtom('approvalStatus')).toBe('boq.approve')
    expect(lineItemPatchAtom('approverId')).toBe('boq.approve')
    expect(lineItemPatchAtom('quantity')).toBe('boq.lines')
  })
  it('limits Sales own-profile edits to photo, mobile and personal email', () => {
    expect(salesPersonPatchAtom('photoUrl')).toBe('sales.ownProfile')
    expect(salesPersonPatchAtom('mobile')).toBe('sales.ownProfile')
    expect(salesPersonPatchAtom('personalEmail')).toBe('sales.ownProfile')
    expect(salesPersonPatchAtom('officialEmail')).toBe('sales.roster')
    expect(salesPersonPatchAtom('status')).toBe('sales.roster')
  })
})

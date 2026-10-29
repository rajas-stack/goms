import { describe, expect, it } from 'vitest'
import type { SalesPerson } from '@/lib/types'
import { claimantFromProfile, isClaimantComplete } from './claimantProfile'

const person = { name: 'Shubham Mehra', employeeCode: '3096', metadata: { businessUnit: 'Corporate', defaultProject: '0-000104' } } as unknown as SalesPerson

describe('claimantFromProfile', () => {
  it('fills the header from the profile, using the posting office as base location', () => {
    const c = claimantFromProfile(person, 'Mumbai')
    expect(c).toEqual({ employeeCode: '3096', employeeName: 'Shubham Mehra', baseLocation: 'Mumbai', businessUnit: 'Corporate', project: '0-000104' })
    expect(isClaimantComplete(c)).toBe(true)
  })
  it('is incomplete without a BU, so the dialog asks for it', () => {
    expect(isClaimantComplete(claimantFromProfile({ ...person, metadata: {} }, 'Mumbai'))).toBe(false)
  })
})

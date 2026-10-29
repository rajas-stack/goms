import type { SalesPerson } from '@/lib/types'
import type { ClaimantDetails } from './conveyanceForm'

/** Directory-profile metadata keys that fill the Local Conveyance Form header. */
export const CLAIMANT_META = { baseLocation: 'baseLocation', businessUnit: 'businessUnit', project: 'defaultProject' } as const

/** The form header from a Directory profile; base location falls back to the current posting's office. */
export function claimantFromProfile(person: SalesPerson, office = ''): ClaimantDetails {
  const meta = person.metadata ?? {}
  return {
    employeeCode: person.employeeCode ?? '', employeeName: person.name,
    baseLocation: meta[CLAIMANT_META.baseLocation] || office, businessUnit: meta[CLAIMANT_META.businessUnit] ?? '',
    project: meta[CLAIMANT_META.project] ?? '',
  }
}

/** True when the profile holds everything the header needs, so the download can skip the dialog. */
export const isClaimantComplete = (d: ClaimantDetails) => !!(d.employeeCode.trim() && d.employeeName.trim() && d.baseLocation.trim() && d.businessUnit.trim())

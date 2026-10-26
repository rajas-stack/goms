import { describe, expect, it } from 'vitest'
import type { CommunicationContact } from '@goms/domain'
import type { MasterEmployee } from '@/features/org/masterEmployees'
import type { Employee } from '@/lib/types'
import {
  externalCategories, fromAccountMappingPerson, fromContact, fromMasterEmployee, internalCategories, matchesType,
  partyForDirectoryType, readTypeFilter,
} from './directoryEntries'

const master = (over: Partial<MasterEmployee>): MasterEmployee => ({
  id: 'o1', key: 'o1', name: 'Asha', email: 'asha@amnex.com', designation: 'Lead', level: 3, departments: ['Pre-Sales', 'Bid Management'],
  sources: ['org'], orgPersonId: 'o1', status: 'active', ...over,
})
const contact = (over: Partial<CommunicationContact>): CommunicationContact => ({
  id: 'c1', email: 'x@oem.com', name: 'Xavier', party: 'oem', organization: 'OEM Ltd', departmentId: null, ...over,
})
const amPerson = { id: 'e1', name: 'Officer', designation: 'Secretary', email: '', phone: '1', photoUrl: null, company: 'Acme' } as Employee

describe('directory entries', () => {
  it('keeps each record’s own kind and id so actions reach the source record', () => {
    expect(fromMasterEmployee(master({}))).toMatchObject({ kind: 'orgPerson', id: 'o1', contactType: 'internal', groups: ['Pre-Sales', 'Bid Management'] })
    expect(fromMasterEmployee(master({ orgPersonId: null, key: 'sales:s1', id: 's1', sources: ['sales'] }))).toMatchObject({ kind: 'salesPerson', id: 's1' })
    expect(fromMasterEmployee(master({ orgPersonId: null, key: 'legal:m1', id: 'm1', sources: ['legal'] }))).toMatchObject({ kind: 'teamMember', id: 'm1' })
    expect(fromAccountMappingPerson(amPerson, 'Dept of IT')).toMatchObject({ kind: 'employee', id: 'e1', contactType: 'external', groups: ['clientDepartment'], organisation: 'Dept of IT' })
    expect(fromAccountMappingPerson(amPerson).organisation).toBe('Acme')
    expect(fromContact(contact({}))).toMatchObject({ kind: 'contact', id: 'c1', groups: ['oem'], organisation: 'OEM Ltd' })
  })

  it('filters by contact type, then by a category of that type', () => {
    const internal = fromMasterEmployee(master({}))
    const oem = fromContact(contact({}))
    expect(matchesType(internal, '', '')).toBe(true)
    expect(matchesType(oem, 'internal', '')).toBe(false)
    expect(matchesType(internal, 'internal', 'bid management')).toBe(true) // any of several departments, any case
    expect(matchesType(internal, 'internal', 'Legal')).toBe(false)
    expect(matchesType(oem, 'external', 'oem')).toBe(true)
    expect(matchesType(oem, 'external', 'competitor')).toBe(false)
  })

  it('names external categories from the Directory Types master, with defaults until it loads', () => {
    expect(externalCategories([{ code: 'internal', name: 'Amnex Employee' }, { code: 'department', name: 'Departmental' }, { code: 'oem', name: 'OEMs' }]))
      .toEqual([{ value: 'clientDepartment', label: 'Departmental' }, { value: 'oem', label: 'OEMs' }])
    expect(externalCategories([]).map((o) => o.value)).toEqual(['clientDepartment', 'oem', 'competitor', 'consortium'])
  })

  it('offers every master department plus any other department already in use', () => {
    const entries = [fromMasterEmployee(master({ departments: ['Sales', 'Design'] }))]
    expect(internalCategories(['Sales', 'HR'], entries).map((o) => o.value)).toEqual(['Sales', 'HR', 'Design'])
  })

  it('maps Directory Types codes to contact categories and reads old links', () => {
    expect(partyForDirectoryType('department')).toBe('clientDepartment')
    expect(partyForDirectoryType('consortium')).toBe('consortium')
    expect(partyForDirectoryType('consultants')).toBeNull()
    expect(readTypeFilter('oem', null)).toEqual({ type: 'external', category: 'oem' })
    expect(readTypeFilter('internal', 'Legal')).toEqual({ type: 'internal', category: 'Legal' })
    expect(readTypeFilter(null, 'Legal')).toEqual({ type: '', category: '' })
  })
})

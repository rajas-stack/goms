import { describe, expect, it } from 'vitest'
import type { OrgPerson } from '@/data/org-structure'
import type { DeliveryTeamKey, DeliveryTeamMember } from '@/lib/types'
import { buildLookups, optionsOf, personOf, STANDARD_COLUMNS } from '@/modules/bid-tracker/gridColumns'
import { opportunityTeamMembers } from './opportunityTeamMembers'

const member = (id: string, team: DeliveryTeamKey, extra: Partial<DeliveryTeamMember> = {}): DeliveryTeamMember => ({
  id, team, name: id, email: '', designation: '', status: 'active', managerId: null, createdAt: '2026-10-14', ...extra,
})
const employee = (id: string, departments: string[], extra: Partial<OrgPerson> = {}): OrgPerson => ({
  id, name: id, email: '', departments, designation: '', level: 3, managerId: null, status: 'active', createdAt: '2026-10-14', ...extra,
})

describe('opportunity ownership dropdowns', () => {
  const people = [
    employee('legal-person', ['Legal']), employee('presales-person', ['Pre-Sales']),
    employee('bid-person', ['Bid Management']), employee('multi-person', ['Pre-Sales', 'Bid Management']),
    employee('moved-person', ['Finance']), employee('inactive-person', ['Legal'], { status: 'inactive' }),
  ]
  const members = [
    member('legal', 'legal', { orgPersonId: 'legal-person' }),
    member('presales', 'preSales', { orgPersonId: 'presales-person' }),
    member('bid', 'bid', { orgPersonId: 'bid-person' }),
    member('multi-presales', 'preSales', { orgPersonId: 'multi-person' }),
    member('multi-bid', 'bid', { orgPersonId: 'multi-person' }),
    member('stale-legal', 'legal', { orgPersonId: 'moved-person' }),
    member('inactive', 'legal', { orgPersonId: 'inactive-person' }),
    member('inactive-roster', 'legal', { status: 'inactive' }),
    member('deleted', 'legal', { orgPersonId: 'deleted-person' }),
  ]

  it.each([
    ['legalPersonId', ['legal']],
    ['preSalesPersonId', ['multi-presales', 'presales']],
    ['bidTeamMemberId', ['bid', 'multi-bid']],
  ])('limits %s to its active department in the shared grid and General form', (field, ids) => {
    const lookups = buildLookups({ persons: [{ id: 'sales', name: 'Sales' }], deliveryTeamMembers: members, orgPeople: people, departments: [], states: [] })
    const column = STANDARD_COLUMNS.find(col => col.id === field)!
    expect(optionsOf(column, lookups).map(option => option.value)).toEqual(ids)
    expect(personOf(column, field === 'legalPersonId' ? 'stale-legal' : (ids as string[])[0], lookups)?.name).toBe(field === 'legalPersonId' ? 'stale-legal' : (ids as string[])[0])
  })

  it('checks legacy members without an org link by email or name', () => {
    const org = [employee('moved', ['Finance'], { email: 'moved@amnex.com' }), employee('Legal Employee', ['Legal'])]
    const roster = [member('old', 'legal', { email: ' MOVED@AMNEX.COM ' }), member('current', 'legal', { name: ' legal   employee ' })]
    expect(opportunityTeamMembers('legal', roster, org).map(person => person.id)).toEqual(['current'])
  })

  it('keeps hand-added team members and permits a member in each department they belong to', () => {
    expect(opportunityTeamMembers('legal', [member('manual', 'legal')], people).map(person => person.id)).toEqual(['manual'])
    expect(opportunityTeamMembers('preSales', members, people).map(person => person.id)).toContain('multi-presales')
    expect(opportunityTeamMembers('bid', members, people).map(person => person.id)).toContain('multi-bid')
  })
})

import { describe, expect, it } from 'vitest'
import type { OrgPerson } from '@/data/org-structure'
import type { DeliveryTeamMember, SalesPerson } from '@/lib/types'
import { buildMasterEmployees, matchesEmployee } from './masterEmployees'

const org = (id: string, name: string, email = '', departments: string[] = []): OrgPerson =>
  ({ id, name, designation: 'Manager', level: 3, departments, managerId: null, email, status: 'active', createdAt: '2026-01-01' })
const member = (id: string, team: DeliveryTeamMember['team'], name: string, email = '', orgPersonId: string | null = null): DeliveryTeamMember =>
  ({ id, team, name, email, designation: '', status: 'active', managerId: null, orgPersonId, createdAt: '2026-01-01' })
const sales = (id: string, name: string, officialEmail: string, status: SalesPerson['status'] = 'active'): SalesPerson => ({
  id, employeeCode: '', name, officialEmail, personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null, status,
  photoUrl: null, notes: '', metadata: {}, createdAt: '2026-01-01', createdBy: null,
})

describe('buildMasterEmployees — every person in GOMS, de-duplicated', () => {
  it('merges the same person across org, rosters and sales by lower-cased email', () => {
    const list = buildMasterEmployees(
      [org('o1', 'Asha Rao', 'Asha@Amnex.com', ['Pre-Sales'])],
      [member('m1', 'preSales', 'Asha Rao', 'asha@amnex.com', 'o1')],
      [sales('s1', 'Asha R.', ' ASHA@amnex.com ')],
    )
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ key: 'o1', orgPersonId: 'o1', name: 'Asha Rao', sources: ['org', 'preSales', 'sales'], departments: ['Pre-Sales'] })
  })

  it('falls back to a normalized name when one side has no email', () => {
    const list = buildMasterEmployees([org('o1', 'Bala  Iyer')], [], [sales('s1', 'bala iyer', 'bala@amnex.com')])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ orgPersonId: 'o1', email: 'bala@amnex.com', sources: ['org', 'sales'] })
  })

  it('keeps two people with the same name but different emails apart', () => {
    const list = buildMasterEmployees([org('o1', 'Dev Patel', 'dev.p@amnex.com')], [], [sales('s1', 'Dev Patel', 'dev.patel@amnex.com')])
    expect(list.map((e) => e.key)).toEqual(['o1', 'sales:s1'])
  })

  it('lists people only in another roster with that roster as their department and no org record', () => {
    const list = buildMasterEmployees([], [member('m9', 'legal', 'Karan Shah', 'karan@amnex.com')], [sales('s2', 'Neha', 'neha@amnex.com', 'resigned')])
    expect(list).toEqual([
      expect.objectContaining({ key: 'legal:m9', orgPersonId: null, level: null, departments: ['Legal'], sources: ['legal'], status: 'active' }),
      expect.objectContaining({ key: 'sales:s2', departments: ['Sales'], status: 'inactive' }),
    ])
  })

  it('searches name, email, designation and departments', () => {
    const [e] = buildMasterEmployees([org('o1', 'Asha Rao', 'asha@amnex.com', ['Bid Management'])], [], [])
    expect(matchesEmployee(e, 'bid man')).toBe(true)
    expect(matchesEmployee(e, 'ASHA@')).toBe(true)
    expect(matchesEmployee(e, 'legal')).toBe(false)
  })
})

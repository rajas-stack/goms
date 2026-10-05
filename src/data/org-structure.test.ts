import { describe, expect, it } from 'vitest'
import { mergeTeamRosters } from './pre-sales-team'
import {
  eligibleManagers, managerProblem, mergeOrgSeed, orgSeedId, reportsBrokenByLevel, syncAllTeamsFromOrg, syncTeamFromOrg,
  type OrgPerson,
} from './org-structure'

const org = () => mergeOrgSeed([])
const person = (people: OrgPerson[], name: string) => people.find((p) => p.name === name)!

describe('org seed', () => {
  it('has one top (Aditya Shah) and every reports-to one level or more above', () => {
    const people = org()
    expect(people.filter((p) => p.managerId === null).map((p) => p.name)).toEqual(['Aditya Shah'])
    for (const p of people) {
      if (!p.managerId) continue
      const manager = people.find((m) => m.id === p.managerId)!
      expect(manager.level, `${p.name} → ${manager.name}`).toBeLessThan(p.level)
    }
  })

  it('treats "Nirav" and "Nirav Shah" as one person and is idempotent', () => {
    const once = org()
    expect(once.filter((p) => p.name.startsWith('Nirav'))).toHaveLength(1)
    expect(mergeOrgSeed(once)).toEqual(once)
  })
})

describe('reports-to rules', () => {
  it('only offers managers at a higher level, outside the person’s own subtree', () => {
    const people = org()
    const harsh = person(people, 'Harsh Pandit')
    const options = eligibleManagers(harsh, people)
    expect(options.every((p) => p.level < harsh.level)).toBe(true)
    expect(options.map((p) => p.name)).toContain('Shamik Joshi')
    expect(options.map((p) => p.name)).not.toContain('Manthan Soni') // same level
  })

  it('explains why a manager is not allowed', () => {
    const people = org()
    const shamik = person(people, 'Shamik Joshi')
    expect(managerProblem(shamik, person(people, 'Harsh Pandit').id, people)).toMatch(/above L2/)
    expect(managerProblem(shamik, person(people, 'Utpal Gandhi').id, people)).toBeNull()
  })

  it('lists direct reports a level change would invalidate', () => {
    const people = org()
    const kampan = person(people, 'Kampan Vyas')
    expect(reportsBrokenByLevel(kampan.id, 5, people).map((p) => p.name).sort()).toEqual(['Mukesh Mehta', 'Shwetang Kotla'])
  })
})

describe('delivery teams derived from the org', () => {
  it('builds Bid as Shamik → Dharmesh → Krutika/Hritika, keeping existing member ids', () => {
    const existing = mergeTeamRosters([])
    const members = syncTeamFromOrg('bid', org(), existing)
    const bid = members.filter((m) => m.team === 'bid' && m.status === 'active')
    const byName = (name: string) => bid.find((m) => m.name === name)!
    expect(byName('Dharmesh Dhamecha').managerId).toBe(byName('Shamik Joshi').id)
    expect(byName('Krutika Shah').managerId).toBe(byName('Dharmesh Dhamecha').id)
    expect(byName('Krutika Shah').id).toBe(existing.find((m) => m.team === 'bid' && m.name === 'Krutika Shah')!.id)
    expect(byName('Shamik Joshi').managerId).toBeNull()
  })

  it('heads Legal with Utpal Gandhi and links every member to its org person', () => {
    const members = syncAllTeamsFromOrg(org(), [])
    const legal = members.filter((m) => m.team === 'legal')
    const byName = (name: string) => legal.find((m) => m.name === name)!
    expect(byName('Denish').managerId).toBe(byName('Utpal Gandhi').id)
    expect(byName('Sharon Itagi').managerId).toBe(byName('Karan Shah').id)
    expect(legal.every((m) => m.orgPersonId)).toBe(true)
  })

  it('reflects a restructure: moving someone in the org moves them in the team', () => {
    const people = org().map((p) => (p.name === 'Sapna Singh' ? { ...p, managerId: orgSeedId('Harsh Pandit') } : p))
    const preSales = syncAllTeamsFromOrg(people, []).filter((m) => m.team === 'preSales')
    expect(preSales.find((m) => m.id === preSales.find((x) => x.name === 'Sapna Singh')!.managerId)?.name).toBe('Harsh Pandit')
  })

  it('turns a member inactive when they leave the department, keeping their id', () => {
    const first = syncAllTeamsFromOrg(org(), [])
    const moved = org().map((p) => (p.name === 'Milap Shah' ? { ...p, departments: ['Sales'] } : p))
    const after = syncAllTeamsFromOrg(moved, first)
    const milap = after.find((m) => m.team === 'preSales' && m.name === 'Milap Shah')!
    expect(milap.status).toBe('inactive')
    expect(milap.id).toBe(first.find((m) => m.team === 'preSales' && m.name === 'Milap Shah')!.id)
  })
})

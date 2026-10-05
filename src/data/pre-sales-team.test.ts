import { describe, expect, it } from 'vitest'
import type { DeliveryTeamMember } from '@/lib/types'
import { BID_TEAM, PRE_SALES_TEAM, mergeTeamRosters, rosterSeedId } from './pre-sales-team'

const byName = (members: DeliveryTeamMember[], team: string, name: string) => members.find((m) => m.team === team && m.name === name)

describe('mergeTeamRosters', () => {
  it('seeds both rosters with every reports-to resolved inside the same team', () => {
    const members = mergeTeamRosters([])
    expect(members.filter((m) => m.team === 'preSales')).toHaveLength(PRE_SALES_TEAM.length)
    expect(members.filter((m) => m.team === 'bid')).toHaveLength(BID_TEAM.length)
    for (const entry of [...PRE_SALES_TEAM, ...BID_TEAM]) {
      const member = byName(members, entry.team, entry.name)!
      const manager = members.find((m) => m.id === member.managerId)
      expect(manager?.name ?? null, entry.name).toBe(entry.reportsTo)
      if (manager) expect(manager.team).toBe(entry.team)
    }
  })

  it('puts Dharmesh under Shamik in the Bid org and keeps him out of Pre-sales', () => {
    const members = mergeTeamRosters([])
    const shamik = byName(members, 'bid', 'Shamik Joshi')!
    expect(byName(members, 'bid', 'Dharmesh Dhamecha')?.managerId).toBe(shamik.id)
    expect(byName(members, 'preSales', 'Dharmesh Dhamecha')).toBeUndefined()
  })

  it('moves an earlier seeded Pre-sales entry to Bid, keeping its id', () => {
    const old: DeliveryTeamMember = {
      id: rosterSeedId('preSales', 'Krutika Shah'), team: 'preSales', name: 'Krutika Shah', email: '',
      designation: 'Manager · Bid Management', status: 'active', managerId: null, createdAt: '2026-10-05',
    }
    const members = mergeTeamRosters([old])
    const krutika = members.filter((m) => m.name === 'Krutika Shah')
    expect(krutika).toHaveLength(1)
    expect(krutika[0]).toMatchObject({ id: old.id, team: 'bid', designation: 'Manager' })
    expect(members.find((m) => m.id === krutika[0].managerId)?.name).toBe('Dharmesh Dhamecha')
  })

  it('is idempotent and never overwrites an edited reports-to', () => {
    const once = mergeTeamRosters([])
    const sagar = byName(once, 'preSales', 'Sagar Chudasama')!
    const edited = once.map((m) => (m.id === sagar.id ? { ...m, managerId: byName(once, 'preSales', 'Harsh Pandit')!.id } : m))
    const twice = mergeTeamRosters(edited)
    expect(twice).toHaveLength(once.length)
    expect(byName(twice, 'preSales', 'Sagar Chudasama')?.managerId).toBe(byName(once, 'preSales', 'Harsh Pandit')!.id)
  })
})

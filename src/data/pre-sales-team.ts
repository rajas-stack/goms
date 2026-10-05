// The Pre-sales and Bid rosters as supplied by the business (2026-10-05).
// Seeded into `deliveryTeamMembers` by seed.ts and topped up into existing local
// data by the v18/v19 migrations; the API seeds the same lists in SQL migration
// 1790300000000_pre-sales-roster.sql. `reportsTo` is a name on the SAME team's
// list, or null at the top — Shamik Joshi reports to Utpal Gandhi, who is not on
// either team. Shamik heads both orgs, so he is on both rosters.
import type { DeliveryTeamKey, DeliveryTeamMember } from '@/lib/types'

export interface TeamRosterEntry {
  team: DeliveryTeamKey
  name: string
  designation: string
  reportsTo: string | null
}

export const PRE_SALES_TEAM: TeamRosterEntry[] = [
  { team: 'preSales', name: 'Shamik Joshi', designation: 'Pre-Sales Head', reportsTo: null },
  { team: 'preSales', name: 'Sagar Chudasama', designation: 'Analyst', reportsTo: 'Shamik Joshi' },
  { team: 'preSales', name: 'Manthan Soni', designation: 'SVP', reportsTo: 'Shamik Joshi' },
  { team: 'preSales', name: 'Harsh Pandit', designation: 'Senior Manager', reportsTo: 'Shamik Joshi' },
  { team: 'preSales', name: 'Gaurav Singal', designation: 'AVP', reportsTo: 'Shamik Joshi' },
  { team: 'preSales', name: 'Srinivas Rao', designation: 'AVP', reportsTo: 'Manthan Soni' },
  { team: 'preSales', name: 'Mohd Faiaz', designation: 'Manager', reportsTo: 'Manthan Soni' },
  { team: 'preSales', name: 'Dilip Panchal', designation: 'VP', reportsTo: 'Manthan Soni' },
  { team: 'preSales', name: 'Dev Patel', designation: 'Lead Consultant', reportsTo: 'Manthan Soni' },
  { team: 'preSales', name: 'Vidwams Madduri', designation: 'Manager', reportsTo: 'Manthan Soni' },
  { team: 'preSales', name: 'Rajesh Rathod', designation: 'Manager', reportsTo: 'Harsh Pandit' },
  { team: 'preSales', name: 'Nitish Thakkar', designation: 'Manager', reportsTo: 'Harsh Pandit' },
  { team: 'preSales', name: 'Mrinmoy Dhara', designation: 'Senior Analyst', reportsTo: 'Harsh Pandit' },
  { team: 'preSales', name: 'Rajas Saji', designation: '', reportsTo: 'Harsh Pandit' },
  { team: 'preSales', name: 'Maher Thakkar', designation: 'Associate Developer', reportsTo: 'Harsh Pandit' },
  { team: 'preSales', name: 'Utkarsh Raval', designation: 'Associate Analyst', reportsTo: 'Harsh Pandit' },
  { team: 'preSales', name: 'Baidyanath Hazra', designation: 'Lead Analyst', reportsTo: 'Nitish Thakkar' },
  { team: 'preSales', name: 'Sapna Singh', designation: 'Analyst', reportsTo: 'Rajesh Rathod' },
  { team: 'preSales', name: 'Kampan Vyas', designation: 'Associate Analyst', reportsTo: 'Gaurav Singal' },
  { team: 'preSales', name: 'Milap Shah', designation: 'DM', reportsTo: 'Gaurav Singal' },
  { team: 'preSales', name: 'Urvish Suthar', designation: 'Senior Analyst', reportsTo: 'Gaurav Singal' },
  { team: 'preSales', name: 'Shwetang Kotla', designation: '', reportsTo: 'Kampan Vyas' },
  { team: 'preSales', name: 'Mukesh Mehta', designation: 'Senior Analyst', reportsTo: 'Kampan Vyas' },
]

export const BID_TEAM: TeamRosterEntry[] = [
  { team: 'bid', name: 'Shamik Joshi', designation: 'Pre-Sales Head', reportsTo: null },
  { team: 'bid', name: 'Dharmesh Dhamecha', designation: 'DGM', reportsTo: 'Shamik Joshi' },
  { team: 'bid', name: 'Krutika Shah', designation: 'Manager', reportsTo: 'Dharmesh Dhamecha' },
  { team: 'bid', name: 'Hritika Nainwani', designation: 'Senior Analyst', reportsTo: 'Dharmesh Dhamecha' },
  { team: 'bid', name: 'Rajeev Maurya', designation: 'Senior Analyst', reportsTo: 'Krutika Shah' },
  { team: 'bid', name: 'Shivani Thakkar', designation: 'Analyst', reportsTo: 'Krutika Shah' },
]

const TEAM_ROSTERS = [...PRE_SALES_TEAM, ...BID_TEAM]

const SEED_DATE = '2026-10-05'
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
/** Stable ids, so re-seeding or topping up never duplicates a person. */
export const rosterSeedId = (team: DeliveryTeamKey, name: string) => `team-${team.toLowerCase()}-${slug(name)}`
const key = (team: string, name: string) => `${team}:${name.trim().toLowerCase()}`

/** Brings `existing` in line with the rosters without overwriting edits:
 *  1. a seeded Pre-sales person who belongs on the Bid roster (an earlier
 *     version of this list had them in Pre-sales) moves to Bid, keeping their id
 *     so opportunity assignments follow them;
 *  2. anyone missing from their team (matched by team + name) is added;
 *  3. a missing reports-to is filled from the roster. */
export function mergeTeamRosters(existing: DeliveryTeamMember[]): DeliveryTeamMember[] {
  const bidNames = new Set(BID_TEAM.filter((e) => e.reportsTo !== null).map((e) => e.name.toLowerCase()))
  const moved = existing.map((member) => (
    member.team === 'preSales' && member.id.startsWith('team-presales-') && bidNames.has(member.name.trim().toLowerCase())
      ? { ...member, team: 'bid' as const, designation: member.designation.replace(/\s*·\s*Bid Management$/, ''), managerId: null }
      : member
  ))
  const byKey = new Map(moved.map((m) => [key(m.team, m.name), m]))
  const added: DeliveryTeamMember[] = TEAM_ROSTERS
    .filter((entry) => !byKey.has(key(entry.team, entry.name)))
    .map((entry) => ({
      id: rosterSeedId(entry.team, entry.name), team: entry.team, name: entry.name, email: '',
      designation: entry.designation, status: 'active', managerId: null, createdAt: SEED_DATE,
    }))
  for (const member of added) byKey.set(key(member.team, member.name), member)
  const managerOf = new Map(TEAM_ROSTERS.map((entry) => [key(entry.team, entry.name), entry.reportsTo]))
  return [...moved, ...added].map((member) => {
    if (member.managerId) return member
    const manager = managerOf.get(key(member.team, member.name))
    const managerId = manager ? byKey.get(key(member.team, manager))?.id ?? null : null
    return managerId ? { ...member, managerId } : member
  })
}

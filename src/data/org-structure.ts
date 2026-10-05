// Amnex's company org structure — the single source of truth for who reports to
// whom. Each person has a level (L0 = Chairman, larger = more junior) and may
// only report to someone at a strictly higher level (smaller number). The
// delivery-team rosters (Pre-sales, Bid, Legal) are derived from this list by
// department, so a restructure here reflects everywhere those teams appear.
//
// Seed list as supplied by the business on 2026-10-05, cleaned:
// - "Nirav" and "Nirav Shah" (both CEO, under Utpal Gandhi) are one person.
// - Shamik Joshi heads Pre-sales and Bid Management, so he is in both.
// - Utpal Gandhi appears in the Legal table, so he heads that team's chart.
// - Karan Shah, Chetana Vora and Laveena Vangani were listed at L2 reporting
//   to Denish (also L2); they are seeded at L3 (and Sharon Itagi, under Karan,
//   at L4) so every reports-to is a higher level.
import type { DeliveryTeamKey, DeliveryTeamMember } from '@/lib/types'

export interface OrgPerson {
  id: string
  name: string
  designation: string
  /** 0 = top of the company; a manager's level is always smaller than their reports'. */
  level: number
  /** Departments this person belongs to — e.g. ['Pre-Sales', 'Bid Management']. */
  departments: string[]
  managerId: string | null
  email: string
  status: 'active' | 'inactive'
  createdAt: string
}

export const ORG_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7] as const
export const levelLabel = (level: number) => `L${level}`

/** Department that feeds each delivery team's roster and org chart. */
export const TEAM_DEPARTMENT: Record<DeliveryTeamKey, string> = {
  preSales: 'Pre-Sales',
  bid: 'Bid Management',
  legal: 'Legal',
}

export const ORG_DEPARTMENTS = [
  'Leadership', 'Sales', 'Pre-Sales', 'Bid Management', 'Legal', 'Finance', 'Technology', 'Business Units',
] as const

interface SeedRow { name: string; level: number; designation: string; departments: string[]; reportsTo: string | null }

const SEED: SeedRow[] = [
  { name: 'Aditya Shah', level: 0, designation: 'Chairman', departments: ['Leadership'], reportsTo: null },
  { name: 'Utpal Gandhi', level: 1, designation: 'MD', departments: ['Leadership', 'Legal'], reportsTo: 'Aditya Shah' },
  { name: 'Tapan Gosalia', level: 1, designation: 'Director', departments: ['Leadership'], reportsTo: 'Aditya Shah' },
  { name: 'Poussin Punnose', level: 1, designation: 'ED & COO', departments: ['Leadership'], reportsTo: 'Aditya Shah' },
  { name: 'Harbinder Khalsa', level: 1, designation: "Chairman's Office", departments: ['Leadership'], reportsTo: 'Aditya Shah' },

  { name: 'JP', level: 2, designation: 'Sales', departments: ['Sales'], reportsTo: 'Utpal Gandhi' },
  { name: 'Shamik Joshi', level: 2, designation: 'Head – Bid & Pre-Sales; Chief of Strategy', departments: ['Pre-Sales', 'Bid Management'], reportsTo: 'Utpal Gandhi' },
  { name: 'Denish', level: 2, designation: 'CFO – Finance & Legal', departments: ['Finance', 'Legal'], reportsTo: 'Utpal Gandhi' },
  { name: 'Anish', level: 2, designation: 'CE&TO', departments: ['Technology'], reportsTo: 'Utpal Gandhi' },
  { name: 'Nirav Shah', level: 2, designation: 'CEO', departments: ['Business Units'], reportsTo: 'Utpal Gandhi' },

  { name: 'Vimal Shah', level: 3, designation: 'Resources & Utility', departments: ['Business Units'], reportsTo: 'Nirav Shah' },
  { name: 'Ashish Desai', level: 3, designation: 'Integrated', departments: ['Business Units'], reportsTo: 'Nirav Shah' },
  { name: 'Mihir Dakwala', level: 3, designation: 'CPTO', departments: ['Business Units'], reportsTo: 'Nirav Shah' },
  { name: 'Ankur Singhania', level: 3, designation: 'Mobility', departments: ['Business Units'], reportsTo: 'Nirav Shah' },
  { name: 'Nilesh Gauda', level: 3, designation: 'Data Fabrics', departments: ['Business Units'], reportsTo: 'Nirav Shah' },
  { name: 'Hardik Mirani', level: 3, designation: 'Mobility', departments: ['Business Units'], reportsTo: 'Nirav Shah' },
  { name: 'Gurpreet Basra', level: 3, designation: 'Traffic', departments: ['Business Units'], reportsTo: 'Nirav Shah' },
  { name: 'Damodaran C', level: 3, designation: 'Pre-Sales', departments: ['Business Units'], reportsTo: 'Nirav Shah' },

  { name: 'Sagar Chudasama', level: 3, designation: 'Analyst', departments: ['Pre-Sales'], reportsTo: 'Shamik Joshi' },
  { name: 'Manthan Soni', level: 3, designation: 'SVP', departments: ['Pre-Sales'], reportsTo: 'Shamik Joshi' },
  { name: 'Harsh Pandit', level: 3, designation: 'Senior Manager', departments: ['Pre-Sales'], reportsTo: 'Shamik Joshi' },
  { name: 'Gaurav Singal', level: 3, designation: 'AVP', departments: ['Pre-Sales'], reportsTo: 'Shamik Joshi' },
  { name: 'Srinivas Rao', level: 4, designation: 'AVP', departments: ['Pre-Sales'], reportsTo: 'Manthan Soni' },
  { name: 'Mohd Faiaz', level: 4, designation: 'Manager', departments: ['Pre-Sales'], reportsTo: 'Manthan Soni' },
  { name: 'Dilip Panchal', level: 4, designation: 'VP', departments: ['Pre-Sales'], reportsTo: 'Manthan Soni' },
  { name: 'Dev Patel', level: 4, designation: 'Lead Consultant', departments: ['Pre-Sales'], reportsTo: 'Manthan Soni' },
  { name: 'Vidwams Madduri', level: 4, designation: 'Manager', departments: ['Pre-Sales'], reportsTo: 'Manthan Soni' },
  { name: 'Rajesh Rathod', level: 4, designation: 'Manager', departments: ['Pre-Sales'], reportsTo: 'Harsh Pandit' },
  { name: 'Nitish Thakkar', level: 4, designation: 'Manager', departments: ['Pre-Sales'], reportsTo: 'Harsh Pandit' },
  { name: 'Mrinmoy Dhara', level: 4, designation: 'Senior Analyst', departments: ['Pre-Sales'], reportsTo: 'Harsh Pandit' },
  { name: 'Rajas Saji', level: 4, designation: 'Associate Developer', departments: ['Pre-Sales'], reportsTo: 'Harsh Pandit' },
  { name: 'Maher Thakkar', level: 4, designation: 'Associate Analyst', departments: ['Pre-Sales'], reportsTo: 'Harsh Pandit' },
  { name: 'Utkarsh Raval', level: 4, designation: 'Lead Analyst', departments: ['Pre-Sales'], reportsTo: 'Harsh Pandit' },
  { name: 'Baidyanath Hazra', level: 5, designation: 'Analyst', departments: ['Pre-Sales'], reportsTo: 'Nitish Thakkar' },
  { name: 'Sapna Singh', level: 5, designation: 'Associate Analyst', departments: ['Pre-Sales'], reportsTo: 'Rajesh Rathod' },
  { name: 'Kampan Vyas', level: 4, designation: 'Deputy Manager', departments: ['Pre-Sales'], reportsTo: 'Gaurav Singal' },
  { name: 'Milap Shah', level: 4, designation: 'Senior Analyst', departments: ['Pre-Sales'], reportsTo: 'Gaurav Singal' },
  { name: 'Urvish Suthar', level: 4, designation: 'Senior Analyst', departments: ['Pre-Sales'], reportsTo: 'Gaurav Singal' },
  { name: 'Shwetang Kotla', level: 5, designation: 'Senior Analyst', departments: ['Pre-Sales'], reportsTo: 'Kampan Vyas' },
  { name: 'Mukesh Mehta', level: 5, designation: 'Analyst', departments: ['Pre-Sales'], reportsTo: 'Kampan Vyas' },

  { name: 'Dharmesh Dhamecha', level: 3, designation: 'DGM', departments: ['Bid Management'], reportsTo: 'Shamik Joshi' },
  { name: 'Krutika Shah', level: 4, designation: 'Manager', departments: ['Bid Management'], reportsTo: 'Dharmesh Dhamecha' },
  { name: 'Hritika Nainwani', level: 4, designation: 'Senior Analyst', departments: ['Bid Management'], reportsTo: 'Dharmesh Dhamecha' },
  { name: 'Rajeev Maurya', level: 5, designation: 'Senior Analyst', departments: ['Bid Management'], reportsTo: 'Krutika Shah' },
  { name: 'Shivani Thakkar', level: 5, designation: 'Analyst', departments: ['Bid Management'], reportsTo: 'Krutika Shah' },

  { name: 'Karan Shah', level: 3, designation: 'Assistant Manager', departments: ['Legal'], reportsTo: 'Denish' },
  { name: 'Chetana Vora', level: 3, designation: 'Deputy Manager', departments: ['Legal'], reportsTo: 'Denish' },
  { name: 'Laveena Vangani', level: 3, designation: 'Manager', departments: ['Legal'], reportsTo: 'Denish' },
  { name: 'Shijo Shaji', level: 3, designation: 'Manager', departments: ['Legal'], reportsTo: 'Denish' },
  { name: 'Sharon Itagi', level: 4, designation: 'Executive', departments: ['Legal'], reportsTo: 'Karan Shah' },
]

const SEED_DATE = '2026-10-05'
const nameKey = (name: string) => name.trim().toLowerCase()
export const orgSeedId = (name: string) => `org-${nameKey(name).replace(/[^a-z0-9]+/g, '-')}`

/** Adds seed people missing from `existing` (by name) and fills a missing
 *  reports-to; never overwrites anything already edited. Idempotent. */
export function mergeOrgSeed(existing: OrgPerson[]): OrgPerson[] {
  const byName = new Map(existing.map((p) => [nameKey(p.name), p]))
  const added: OrgPerson[] = SEED.filter((row) => !byName.has(nameKey(row.name))).map((row) => ({
    id: orgSeedId(row.name), name: row.name, designation: row.designation, level: row.level,
    departments: row.departments, managerId: null, email: '', status: 'active', createdAt: SEED_DATE,
  }))
  for (const p of added) byName.set(nameKey(p.name), p)
  const reportsTo = new Map(SEED.map((row) => [nameKey(row.name), row.reportsTo]))
  return [...existing, ...added].map((p) => {
    if (p.managerId) return p
    const manager = reportsTo.get(nameKey(p.name))
    const managerId = manager ? byName.get(nameKey(manager))?.id ?? null : null
    return managerId ? { ...p, managerId } : p
  })
}

// --- rules ---------------------------------------------------------------------

/** Everyone under `id` (any depth), including `id` itself. */
export function descendantsOf(id: string, people: OrgPerson[]): Set<string> {
  const found = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of people) {
      if (p.managerId && found.has(p.managerId) && !found.has(p.id)) { found.add(p.id); grew = true }
    }
  }
  return found
}

/** People `person` may report to: active, at a strictly higher level, and not in their own subtree. */
export function eligibleManagers(person: Pick<OrgPerson, 'id' | 'level'>, people: OrgPerson[]): OrgPerson[] {
  const blocked = descendantsOf(person.id, people)
  return people
    .filter((p) => p.status === 'active' && p.level < person.level && !blocked.has(p.id))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

/** Why `managerId` can't be `person`'s manager, or null when it can. */
export function managerProblem(person: Pick<OrgPerson, 'id' | 'level'>, managerId: string | null, people: OrgPerson[]): string | null {
  if (!managerId) return null
  const manager = people.find((p) => p.id === managerId)
  if (!manager) return 'That manager no longer exists.'
  if (manager.level >= person.level) return `A ${levelLabel(person.level)} can only report to someone above ${levelLabel(person.level)}.`
  if (descendantsOf(person.id, people).has(managerId)) return 'That would make the reporting line circular.'
  return null
}

/** People whose reports-to became invalid after `person`'s level changed (their manager is no longer above them). */
export function reportsBrokenByLevel(personId: string, newLevel: number, people: OrgPerson[]): OrgPerson[] {
  return people.filter((p) => p.managerId === personId && p.level <= newLevel)
}

// --- derived delivery-team rosters -------------------------------------------------

/** The delivery-team roster implied by the org: everyone in the team's department,
 *  each reporting to their nearest org ancestor who is also in that department.
 *  `existing` members of the team are matched by `orgPersonId`, then by name, and
 *  keep their ids (opportunity assignments point at them); members no longer in the
 *  department turn inactive rather than disappearing. Members added by hand
 *  (no org link, no name match) are left untouched. */
export function syncTeamFromOrg(team: DeliveryTeamKey, people: OrgPerson[], existing: DeliveryTeamMember[]): DeliveryTeamMember[] {
  const department = TEAM_DEPARTMENT[team]
  const inTeam = people.filter((p) => p.departments.includes(department))
  const orgById = new Map(people.map((p) => [p.id, p]))
  const others = existing.filter((m) => m.team !== team)
  const current = existing.filter((m) => m.team === team)
  const byOrg = new Map(current.filter((m) => m.orgPersonId).map((m) => [m.orgPersonId!, m]))
  const byName = new Map(current.filter((m) => !m.orgPersonId).map((m) => [nameKey(m.name), m]))

  const memberIdOf = new Map<string, string>()
  const synced: DeliveryTeamMember[] = inTeam.map((p) => {
    const match = byOrg.get(p.id) ?? byName.get(nameKey(p.name))
    const id = match?.id ?? `team-${team.toLowerCase()}-${p.id}`
    memberIdOf.set(p.id, id)
    return {
      id, team, name: p.name, email: p.email || match?.email || '', designation: p.designation,
      status: p.status, managerId: null, orgPersonId: p.id, createdAt: match?.createdAt ?? p.createdAt,
    }
  })
  const teamManager = (p: OrgPerson): string | null => {
    for (let cursor = p.managerId ? orgById.get(p.managerId) : undefined; cursor; cursor = cursor.managerId ? orgById.get(cursor.managerId) : undefined) {
      const id = memberIdOf.get(cursor.id)
      if (id) return id
    }
    return null
  }
  const withManagers = synced.map((m) => ({ ...m, managerId: teamManager(orgById.get(m.orgPersonId!)!) }))

  const syncedIds = new Set(withManagers.map((m) => m.id))
  const leftovers = current
    .filter((m) => !syncedIds.has(m.id))
    .map((m) => (m.orgPersonId ? { ...m, status: 'inactive' as const, managerId: null } : m))
  return [...others, ...withManagers, ...leftovers]
}

export const syncAllTeamsFromOrg = (people: OrgPerson[], existing: DeliveryTeamMember[]): DeliveryTeamMember[] =>
  (Object.keys(TEAM_DEPARTMENT) as DeliveryTeamKey[]).reduce((members, team) => syncTeamFromOrg(team, people, members), existing)

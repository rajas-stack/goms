// The master employee list: everyone GOMS knows about, as one de-duplicated list. Read-side only — nothing is migrated.
// Sources: the company org (org_people, the primary record and the only editable one here), the Sales roster
// (sales_persons) and the Pre-sales / Bid / Legal rosters (delivery_team_members; members mirrored from the org are
// folded into their org person). People are matched by lower-cased email, falling back to a normalized name when one side
// has no email.
import { SALES_ROLE_STATUSES } from '@goms/domain'
import type { DeliveryTeamKey, DeliveryTeamMember, SalesPerson } from '@/lib/types'
import { TEAM_DEPARTMENT, type OrgPerson } from '@/data/org-structure'

export type EmployeeSource = 'org' | 'sales' | DeliveryTeamKey

export const SOURCE_LABEL: Record<EmployeeSource, string> = {
  org: 'Employees', sales: 'Sales', preSales: 'Pre-sales', bid: 'Bid', legal: 'Legal',
}

export interface MasterEmployee {
  /** Source record ID used by the shared Drive avatar index. */
  id?: string
  /** Stable row key: the org person id, else `<source>:<id>` of the first record seen. */
  key: string
  name: string
  email: string
  designation: string
  /** Null for people who are not in the org yet. */
  level: number | null
  departments: string[]
  sources: EmployeeSource[]
  /** Set when the person is in Teams > Employees (org_people); null means "only in another roster". */
  orgPersonId: string | null
  status: 'active' | 'inactive'
}

export const normalizeName = (name: string): string => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
export const normalizeEmailKey = (email: string | null | undefined): string => (email ?? '').trim().toLowerCase()

interface Candidate {
  id: string
  key: string
  name: string
  email: string
  designation: string
  level: number | null
  departments: string[]
  source: EmployeeSource
  orgPersonId: string | null
  active: boolean
}

const fromOrg = (p: OrgPerson): Candidate => ({
  id: p.id, key: p.id, name: p.name, email: p.email ?? '', designation: p.designation, level: p.level, departments: p.departments,
  source: 'org', orgPersonId: p.id, active: p.status === 'active',
})
const fromMember = (m: DeliveryTeamMember): Candidate => ({
  id: m.id, key: `${m.team}:${m.id}`, name: m.name, email: m.email ?? '', designation: m.designation ?? '', level: null,
  departments: [TEAM_DEPARTMENT[m.team]], source: m.team, orgPersonId: m.orgPersonId ?? null, active: m.status === 'active',
})
const fromSales = (s: SalesPerson): Candidate => ({
  id: s.id, key: `sales:${s.id}`, name: s.name, email: s.officialEmail ?? '', designation: s.metadata?.designation ?? '', level: null,
  departments: ['Sales'], source: 'sales', orgPersonId: null, active: (SALES_ROLE_STATUSES as readonly string[]).includes(s.status),
})

const toEmployee = (c: Candidate): MasterEmployee => ({
  id: c.id, key: c.key, name: c.name, email: c.email.trim(), designation: c.designation, level: c.level, departments: [...c.departments],
  sources: [c.source], orgPersonId: c.orgPersonId, status: c.active ? 'active' : 'inactive',
})

const union = (a: readonly string[], b: readonly string[]) =>
  [...a, ...b.filter((d) => !a.some((x) => x.toLowerCase() === d.toLowerCase()))]

/** Folds `c` into `e`: the org record wins; other sources only fill gaps. */
function merge(e: MasterEmployee, c: Candidate): MasterEmployee {
  return {
    ...e,
    email: e.email || c.email.trim(),
    designation: e.designation || c.designation,
    departments: e.orgPersonId ? e.departments : union(e.departments, c.departments),
    sources: e.sources.includes(c.source) ? e.sources : [...e.sources, c.source],
    status: e.status === 'active' || c.active ? 'active' : 'inactive',
  }
}

function findMatch(list: readonly MasterEmployee[], c: Candidate): number {
  if (c.orgPersonId) {
    const linked = list.findIndex((e) => e.orgPersonId === c.orgPersonId)
    if (linked >= 0) return linked
  }
  const email = normalizeEmailKey(c.email)
  if (email) {
    const byEmail = list.findIndex((e) => normalizeEmailKey(e.email) === email)
    if (byEmail >= 0) return byEmail
  }
  const name = normalizeName(c.name)
  // A name only matches when at least one side has no email (two different emails are two people).
  return list.findIndex((e) => normalizeName(e.name) === name && (!email || !e.email))
}

/** Org people first (they are the primary record), then roster members, then the Sales roster. */
export function buildMasterEmployees(
  org: readonly OrgPerson[], members: readonly DeliveryTeamMember[], sales: readonly SalesPerson[],
): MasterEmployee[] {
  const candidates = [...org.map(fromOrg), ...members.map(fromMember), ...sales.map(fromSales)]
  const list = candidates.reduce<MasterEmployee[]>((acc, c) => {
    if (!c.name.trim()) return acc
    const at = findMatch(acc, c)
    return at < 0 ? [...acc, toEmployee(c)] : acc.map((e, i) => (i === at ? merge(e, c) : e))
  }, [])
  return list.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name))
}

/** Case-insensitive match on name, email, designation and departments. */
export function matchesEmployee(e: MasterEmployee, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${e.name} ${e.email} ${e.designation} ${e.departments.join(' ')}`.toLowerCase().includes(q)
}

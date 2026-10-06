import { DERIVED_ROLE_DEPARTMENTS, ROLES, SALES_ROLE_STATUSES, type Role, type UserFacts } from '@goms/domain'
import { pool } from '../../db.js'
import { isAllowListed } from '../identity.js'

const TTL_MS = 60_000
const cache = new Map<string, { at: number; facts: UserFacts }>()

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()
export function clearUserFactsCache(): void { cache.clear() }

/** One line per ambiguous identity; Cloud Logging picks it up from stdout like `rbac.would_deny`. */
function warnAmbiguous(source: string, email: string, message: string): void {
  console.warn(JSON.stringify({ event: 'rbac.ambiguous_identity', source, email, message }))
}

export type TeamKey = 'preSales' | 'legal' | 'bid'
export interface TeamCandidate { id: string; team: string; direct: boolean }

/** Binds a login to delivery-team member ids, per team. A team with more than one distinct candidate is ambiguous and binds
 *  nothing (picking one would hand the login someone else's `asg` rows). When the org identity itself is ambiguous, candidates
 *  reached only through the org-person link are ignored. Pure: shared by loadUserFacts and the readiness view. */
export function bindTeamMembers(
  candidates: readonly TeamCandidate[], orgAmbiguous: boolean,
): { ids: UserFacts['teamMemberIds']; ambiguousTeams: TeamKey[] } {
  const usable = orgAmbiguous ? candidates.filter((c) => c.direct) : candidates
  const ids: Record<TeamKey, string[]> = { preSales: [], legal: [], bid: [] }
  const ambiguousTeams: TeamKey[] = []
  for (const team of ['preSales', 'legal', 'bid'] as const) {
    const distinct = [...new Set(usable.filter((c) => c.team === team).map((c) => c.id))]
    if (distinct.length === 1) ids[team] = distinct
    else if (distinct.length > 1) ambiguousTeams.push(team)
  }
  return { ids: { presales: ids.preSales, legal: ids.legal, bid: ids.bid }, ambiguousTeams }
}

/** derived ∪ override grants − override revokes, plus System Admin for allow-listed accounts, in ROLES order (spec §3.1, §3.4). */
export function combineRoles(
  derived: Iterable<Role>, overrides: { role: Role; effect: 'grant' | 'revoke' }[], adminAllowListed: boolean,
): Role[] {
  const roles = new Set<Role>(derived)
  for (const { role, effect } of overrides) {
    if (effect === 'grant') roles.add(role)
    else roles.delete(role)
  }
  if (adminAllowListed) roles.add('system_admin')
  return ROLES.filter((r) => roles.has(r))
}

/** Effective roles (spec §3.1): derived ∪ override grants − override revokes; ADMIN_ALLOWED_EMAILS members are then added
 *  as System Admin (spec §3.4), which no override can remove.
 *  Also resolves the caller's roster ids, which scope checks need. Cached per email for 60 s. */
export async function loadUserFacts(rawEmail: string): Promise<UserFacts> {
  const email = normalizeEmail(rawEmail)
  const hit = cache.get(email)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.facts

  const roles = new Set<Role>()
  let finalRoles: Role[] = []
  let salesPersonId: string | null = null
  let teamMemberIds: UserFacts['teamMemberIds'] = { presales: [], legal: [], bid: [] }

  if (email) {
    // Two active org people can share one address. Merging their departments would hand this login someone else's roles, so an
    // ambiguous address derives nothing (an explicit override can still grant a role).
    const org = await pool.query(
      `SELECT departments FROM org_people WHERE status = 'active' AND lower(btrim(email)) = $1 LIMIT 2`, [email],
    )
    const orgAmbiguous = org.rows.length > 1
    if (orgAmbiguous) warnAmbiguous('org_people', email, 'more than one active org person has this email; no role is derived from the org chart and no org-linked team member is bound')
    else for (const row of org.rows) {
      for (const [role, department] of Object.entries(DERIVED_ROLE_DEPARTMENTS)) {
        if ((row.departments as string[]).includes(department)) roles.add(role as Role)
      }
    }

    // Two eligible roster rows can share one address (the unique index is exact-match, so case / spacing variants coexist).
    // Picking one would hand this login someone else's `own` records, so an ambiguous address resolves to no row at all.
    const sales = await pool.query(
      `SELECT id FROM sales_persons WHERE status = ANY($2::text[]) AND lower(btrim(official_email)) = $1 LIMIT 2`, [email, [...SALES_ROLE_STATUSES]],
    )
    if (sales.rows.length === 1) { roles.add('sales'); salesPersonId = sales.rows[0].id }
    else if (sales.rows.length > 1) warnAmbiguous('sales_persons', email, 'more than one active roster row has this email; no Sales role or roster row is derived')

    const overrides = await pool.query(`SELECT role, effect FROM user_role_overrides WHERE email = $1`, [email])
    finalRoles = combineRoles(roles, overrides.rows, isAllowListed(email, process.env.ADMIN_ALLOWED_EMAILS))

    const members = await pool.query(
      `SELECT m.id, m.team, (lower(btrim(m.email)) = $1) AS direct FROM delivery_team_members m
         LEFT JOIN org_people p ON p.id = m.org_person_id
        WHERE m.status = 'active' AND (lower(btrim(m.email)) = $1 OR lower(btrim(p.email)) = $1)`,
      [email],
    )
    const bound = bindTeamMembers(members.rows as TeamCandidate[], orgAmbiguous)
    teamMemberIds = bound.ids
    for (const team of bound.ambiguousTeams) {
      warnAmbiguous('delivery_team_members', email, `more than one active ${team} team member has this email; no ${team} member id is bound`)
    }
  }

  const facts: UserFacts = { email, roles: finalRoles, salesPersonId, teamMemberIds }
  cache.set(email, { at: Date.now(), facts })
  return facts
}

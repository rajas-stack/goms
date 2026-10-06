import { DERIVED_ROLE_DEPARTMENTS, ROLES, SALES_ROLE_STATUSES, type Role, type UserFacts } from '@goms/domain'
import { pool } from '../../db.js'
import { isAllowListed } from '../identity.js'

const TTL_MS = 60_000
const cache = new Map<string, { at: number; facts: UserFacts }>()

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()
export function clearUserFactsCache(): void { cache.clear() }

/** Effective roles (spec §3.1): derived ∪ override grants − override revokes; ADMIN_ALLOWED_EMAILS always adds IT.
 *  Also resolves the caller's roster ids, which scope checks need. Cached per email for 60 s. */
export async function loadUserFacts(rawEmail: string): Promise<UserFacts> {
  const email = normalizeEmail(rawEmail)
  const hit = cache.get(email)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.facts

  const roles = new Set<Role>()
  let salesPersonId: string | null = null
  let teamMemberIds: UserFacts['teamMemberIds'] = { presales: [], legal: [], bid: [] }

  if (email) {
    const org = await pool.query(
      `SELECT departments FROM org_people WHERE status = 'active' AND lower(btrim(email)) = $1`, [email],
    )
    for (const row of org.rows) {
      for (const [role, department] of Object.entries(DERIVED_ROLE_DEPARTMENTS)) {
        if ((row.departments as string[]).includes(department)) roles.add(role as Role)
      }
    }

    const sales = await pool.query(
      `SELECT id FROM sales_persons WHERE status = ANY($2::text[]) AND lower(btrim(official_email)) = $1 LIMIT 1`, [email, [...SALES_ROLE_STATUSES]],
    )
    if (sales.rows[0]) { roles.add('sales'); salesPersonId = sales.rows[0].id }

    const overrides = await pool.query(`SELECT role, effect FROM user_role_overrides WHERE email = $1`, [email])
    for (const { role, effect } of overrides.rows) {
      if (effect === 'grant') roles.add(role as Role)
      else roles.delete(role as Role)
    }
    // Break-glass: allow-listed admins always hold IT and cannot be locked out through an override.
    if (isAllowListed(email, process.env.ADMIN_ALLOWED_EMAILS)) roles.add('it')

    const members = await pool.query(
      `SELECT m.id, m.team FROM delivery_team_members m
         LEFT JOIN org_people p ON p.id = m.org_person_id
        WHERE m.status = 'active' AND (lower(btrim(m.email)) = $1 OR lower(btrim(p.email)) = $1)`,
      [email],
    )
    const ids = (team: string) => members.rows.filter((m) => m.team === team).map((m) => m.id as string)
    teamMemberIds = { presales: ids('preSales'), legal: ids('legal'), bid: ids('bid') }
  }

  const facts: UserFacts = { email, roles: ROLES.filter((r) => roles.has(r)), salesPersonId, teamMemberIds }
  cache.set(email, { at: Date.now(), facts })
  return facts
}

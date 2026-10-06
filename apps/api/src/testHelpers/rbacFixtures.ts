import { randomUUID } from 'node:crypto'
import type { Role } from '@goms/domain'
import { pool } from '../db.js'
import { clearUserFactsCache } from '../auth/rbac/userFacts.js'

/** Every fixture is named / emailed `RBAC …` / `rbac-…` so cleanup can sweep a shared database safely. */
export const rbacEmail = (label: string): string => `rbac-${label}@amnex.com`

const made = { bids: [] as string[], opportunities: [] as string[] }

export async function addOrgPerson(label: string, departments: string[], opts: { status?: 'active' | 'inactive'; email?: string } = {}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO org_people (name, level, departments, email, status) VALUES ($1, 4, $2, $3, $4) RETURNING id`,
    [`RBAC ${label}`, departments, opts.email ?? rbacEmail(label), opts.status ?? 'active'],
  )
  clearUserFactsCache()
  return rows[0].id
}

export async function addSalesPerson(label: string, status = 'active', email = rbacEmail(label)): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO sales_persons (name, official_email, status) VALUES ($1, $2, $3) RETURNING id`, [`RBAC ${label}`, email, status],
  )
  clearUserFactsCache()
  return rows[0].id
}

export async function addTeamMember(team: 'preSales' | 'legal' | 'bid', label: string, email = rbacEmail(label)): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO delivery_team_members (team, name, email) VALUES ($1, $2, $3) RETURNING id`, [team, `RBAC ${label}`, email],
  )
  clearUserFactsCache()
  return rows[0].id
}

/** Grants (or revokes) a role for `rbac-<label>@amnex.com` through the override table. */
export async function setRole(label: string, role: Role, effect: 'grant' | 'revoke' = 'grant'): Promise<void> {
  await pool.query(
    `INSERT INTO user_role_overrides (email, role, effect, reason, created_by) VALUES ($1,$2,$3,'rbac test','tester@amnex.com')
     ON CONFLICT (email, role) DO UPDATE SET effect = EXCLUDED.effect`,
    [rbacEmail(label), role, effect],
  )
  clearUserFactsCache()
}

export interface BidFixtureOptions {
  sheet?: string
  withBid?: boolean
  createdBy?: string | null
  geoSalesPersonId?: string | null
  buSalesPersonId?: string | null
  preSalesPersonId?: string | null
  legalPersonId?: string | null
  bidTeamMemberId?: string | null
}

/** An opportunity (no department) plus, unless `withBid: false`, its bid on `sheet`. */
export async function makeBid(o: BidFixtureOptions = {}): Promise<{ opportunityId: string; bidId: string | null }> {
  const opp = await pool.query(
    `INSERT INTO opportunities (opportunity_name, created_by, geo_sales_person_id, bu_sales_person_id, pre_sales_person_id, legal_person_id, bid_team_member_id)
     VALUES ('RBAC fixture', $1, $2, $3, $4, $5, $6) RETURNING id`,
    [o.createdBy ?? null, o.geoSalesPersonId ?? null, o.buSalesPersonId ?? null, o.preSalesPersonId ?? null, o.legalPersonId ?? null, o.bidTeamMemberId ?? null],
  )
  const opportunityId = opp.rows[0].id as string
  made.opportunities.push(opportunityId)
  if (o.withBid === false) return { opportunityId, bidId: null }
  const bid = await pool.query(
    `INSERT INTO bids (opportunity_id, bid_code, sheet) VALUES ($1, $2, $3) RETURNING id`,
    [opportunityId, `RBAC-${randomUUID()}`, o.sheet ?? 'bidTracker'],
  )
  made.bids.push(bid.rows[0].id)
  return { opportunityId, bidId: bid.rows[0].id }
}

export async function assignOwner(entityType: string, entityId: string, salesPersonId: string, role = 'owner'): Promise<void> {
  await pool.query(
    `INSERT INTO ownership_assignments (entity_type, entity_id, sales_person_id, role, start_date, end_date)
     VALUES ($1,$2,$3,$4,'2020-01-01',$5)`,
    [entityType, entityId, salesPersonId, role, role === 'delegate' ? '2999-01-01' : null],
  )
}

export async function cleanupRbacFixtures(): Promise<void> {
  const ids = [...made.bids, ...made.opportunities]
  if (ids.length) {
    await pool.query('DELETE FROM ownership_assignments WHERE entity_id = ANY($1::uuid[])', [ids])
    await pool.query('DELETE FROM follow_ups WHERE entity_id = ANY($1::uuid[])', [ids])
    await pool.query('DELETE FROM bid_milestones WHERE bid_id = ANY($1::uuid[])', [made.bids])
    await pool.query('DELETE FROM bids WHERE id = ANY($1::uuid[])', [made.bids])
    await pool.query('DELETE FROM opportunities WHERE id = ANY($1::uuid[])', [made.opportunities])
  }
  made.bids.length = 0
  made.opportunities.length = 0
  await pool.query(`DELETE FROM follow_ups WHERE created_by LIKE 'rbac-%'`)
  await pool.query(`DELETE FROM timeline_events WHERE created_by LIKE 'rbac-%'`)
  await pool.query(`DELETE FROM user_role_overrides WHERE email LIKE 'rbac-%'`)
  await pool.query(`DELETE FROM delivery_team_members WHERE name LIKE 'RBAC %'`)
  await pool.query(`DELETE FROM org_people WHERE name LIKE 'RBAC %'`)
  await pool.query(`DELETE FROM sales_persons WHERE name LIKE 'RBAC %'`)
  clearUserFactsCache()
}

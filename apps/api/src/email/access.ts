import { TRPCError } from '@trpc/server'
import { accessFor, treeAllows, type EmailAction, type EmailEntity, type EmailEntityRef, type RbacMyAccess, type UserFacts } from '@goms/domain'
import { isAmnexAccount, verifyIdentity } from '../auth/identity.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'
import { loadUserFacts } from '../auth/rbac/userFacts.js'
import { rowForOpportunity, rowForOwnedEntity, rowForTimelineEvent } from '../auth/rbac/rows.js'
import { resolveForEmail } from '../lib/rbacTreeStore.js'
import { pool } from '../db.js'
import type { Context } from '../trpc.js'

export interface EmailActor { uid: string; email: string; facts: UserFacts; tree: RbacMyAccess }
export const deniedEmailRecord = () => new TRPCError({ code: 'NOT_FOUND', message: 'This record or email is unavailable to your account.' })
const treeAction = (action: EmailAction) => ['view', 'team', 'supervisor'].includes(action) ? 'view' as const : action === 'download' ? 'download' as const : action === 'manageAccess' ? 'manage' as const : 'edit' as const
export function emailActionAllowed(actor: EmailActor, action: EmailAction) {
  return treeAllows(actor.tree, 'email', 'view') && treeAllows(actor.tree, `email.${action}`, treeAction(action))
}
export function assertEmailAction(actor: EmailActor, action: EmailAction) {
  if (!emailActionAllowed(actor, action)) throw new TRPCError({ code: 'FORBIDDEN', message: `Your Email Center permissions do not allow ${action}.` })
}
export async function emailActor(ctx: Context): Promise<EmailActor> {
  const identity = await verifyIdentity(ctx.authHeader)
  if (!isAmnexAccount(identity.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with an approved company Google Workspace account.' })
  const email = identity.email.toLowerCase()
  // Email relationships cannot inherit the ordinary role/tree caches' revocation delay.
  const facts = await loadUserFacts(email, true)
  const actor = { uid: identity.uid, email, facts, tree: await resolveForEmail(email, facts.roles, true) }
  assertEmailAction(actor, 'view'); return actor
}
export async function refreshEmailActor(actor: EmailActor) {
  const facts = await loadUserFacts(actor.email, true)
  return { ...actor, facts, tree: await resolveForEmail(actor.email, facts.roles, true) }
}
/** Fresh org reporting lines, rather than names or a hard-coded BU label. */
export async function managesEmailOwner(managerEmail: string, employeeEmail: string): Promise<boolean> {
  if (managerEmail === employeeEmail) return false
  const { rows } = await pool.query(`WITH RECURSIVE chain AS (
    SELECT id,manager_id,email,ARRAY[id] AS path FROM org_people WHERE lower(btrim(email))=$1 AND status='active'
    UNION ALL SELECT p.id,p.manager_id,p.email,c.path||p.id FROM org_people p JOIN chain c ON p.id=c.manager_id
    WHERE p.status='active' AND NOT p.id=ANY(c.path) AND cardinality(c.path)<32
  ) SELECT id FROM chain WHERE lower(btrim(email))=$2 AND cardinality(path)>1`, [employeeEmail, managerEmail])
  return rows.length > 0
}
async function opportunityEntity(actor: EmailActor, id: string): Promise<EmailEntity> {
  const row = await rowForOpportunity(id)
  if (!row || accessFor(actor.facts, row.module, row.facts).level === 'N') throw deniedEmailRecord()
  const f = row.facts
  let involved = f.createdBy === actor.email || !!actor.facts.salesPersonId && f.salesOwnerIds.includes(actor.facts.salesPersonId)
    || !!f.assigned.presales && actor.facts.teamMemberIds.presales.includes(f.assigned.presales)
    || !!f.assigned.legal && actor.facts.teamMemberIds.legal.includes(f.assigned.legal)
    || !!f.assigned.bid && actor.facts.teamMemberIds.bid.includes(f.assigned.bid)

  if (!involved) {
    const owners = await pool.query(`SELECT lower(btrim(official_email)) AS email FROM sales_persons WHERE id=ANY($1::uuid[])
      UNION SELECT lower(btrim(email)) FROM delivery_team_members WHERE id=ANY($2::uuid[])`, [f.salesOwnerIds, Object.values(f.assigned).filter(Boolean)])
    const ownerEmails = [...new Set([...owners.rows.map(owner => owner.email), f.createdBy].filter(Boolean))]
    for (const owner of ownerEmails.map(email => ({ email }))) {
      if (owner.email && await managesEmailOwner(actor.email, owner.email)) { involved = true; break }
    }
    // Admin status alone never opens Opportunity mail. An approved grant from a currently involved owner can.
    if (!involved && isSystemAdminEmail(actor.email) && emailActionAllowed(actor, 'supervisor')) {
      const approved = await pool.query(`SELECT g.id FROM email_access_grants g JOIN email_mailboxes m ON m.id=g.mailbox_id
        WHERE g.grantee=$1 AND g.kind='superadmin' AND g.status='approved' AND g.expires_at>now()
        AND m.status='connected' AND m.owner_email=ANY($3::text[]) AND (g.entity_type IS NULL OR g.entity_type='opportunity' AND g.entity_id=$2) LIMIT 1`, [actor.email, id, ownerEmails])
      involved = approved.rows.length > 0
    }
  }
  if (!involved) throw deniedEmailRecord()
  const opportunity = (await pool.query('SELECT opportunity_name FROM opportunities WHERE id=$1', [id])).rows[0]
  if (!opportunity) throw deniedEmailRecord()
  return { type: 'opportunity', id, title: opportunity.opportunity_name, path: row.bidId ? `/live-bids/bid/${row.bidId}?tab=communication` : '/live-bids' }
}
/** Extensible record adapters. Every new entity must supply existence, access and a real navigation target. */
export const emailEntityAdapters: Record<string, (actor: EmailActor, id: string) => Promise<EmailEntity>> = {
  opportunity: opportunityEntity,
  async meeting(actor, id) {
    const facts = await rowForTimelineEvent(id)
    if (!facts || accessFor(actor.facts, 'am.meetings', facts).level === 'N') throw deniedEmailRecord()
    const row = (await pool.query('SELECT title FROM timeline_events WHERE id=$1', [id])).rows[0]
    if (!row) throw deniedEmailRecord()
    return { type: 'meeting', id, title: row.title, path: `/meetings/${id}` }
  },
  async department(actor, id) {
    const facts = await rowForOwnedEntity('orgNode', id)
    if (!facts || accessFor(actor.facts, 'am.departments', facts).level === 'N') throw deniedEmailRecord()
    const row = (await pool.query("SELECT name,state_code FROM hierarchy_nodes WHERE id=$1 AND domain='org'", [id])).rows[0]
    if (!row) throw deniedEmailRecord()
    return { type: 'department', id, title: row.name, path: `/state/${row.state_code ?? 0}?sel=${id}&kind=node` }
  },
  async contact(actor, id) {
    const facts = await rowForOwnedEntity('contact', id)
    if (!facts || accessFor(actor.facts, 'am.contacts', facts).level === 'N') throw deniedEmailRecord()
    const row = (await pool.query('SELECT name FROM employees WHERE id=$1', [id])).rows[0]
    if (!row) throw deniedEmailRecord()
    return { type: 'contact', id, title: row.name, path: `/directory?sel=${id}&kind=employee` }
  },
}
export async function assertEmailEntity(actor: EmailActor, ref: EmailEntityRef, fresh = false) {
  const current = fresh ? await refreshEmailActor(actor) : actor
  assertEmailAction(current, 'view')
  const node = { opportunity: 'opportunity.bid.communication', meeting: 'accountMapping.meetings.detail', department: 'accountMapping.map', contact: 'accountMapping.directory' }[ref.type]
  if (node && !treeAllows(current.tree, node, 'view')) throw deniedEmailRecord()
  if (!emailEntityAdapters[ref.type] || !Object.prototype.hasOwnProperty.call(emailEntityAdapters, ref.type)) throw deniedEmailRecord()
  return emailEntityAdapters[ref.type](current, ref.id)
}
export async function visibleEmailEntity(actor: EmailActor, ref: EmailEntityRef) {
  try { return await assertEmailEntity(actor, ref) } catch (error) {
    if (error instanceof TRPCError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) return null
    throw error
  }
}

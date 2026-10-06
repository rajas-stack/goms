import {
  DEFAULT_OWNED_SHEET, activeDelegate, effectiveOwner, isOwnedSheet, type OwnedSheet, type PolicyModuleKey, type ScopeFacts,
} from '@goms/domain'
import { pool } from '../../db.js'
import { loadOwnershipContext } from '../../lib/ownershipContext.js'

export type RowModule = Extract<PolicyModuleKey, 'opp.bidTracker' | 'opp.pipeline' | 'opp.campaign'>

export const SHEET_MODULE: Record<OwnedSheet, RowModule> = {
  bidTracker: 'opp.bidTracker',
  'pipeline-funnel': 'opp.pipeline', 'pipeline-backup': 'opp.pipeline', 'pipeline-commits': 'opp.pipeline',
  campaign: 'opp.campaign',
}
/** Unknown or absent sheet (a bid-less opportunity) is authorised as Bid Tracker. */
export const sheetModule = (sheet: unknown): RowModule => SHEET_MODULE[isOwnedSheet(sheet) ? sheet : DEFAULT_OWNED_SHEET]

export interface RowTarget { module: RowModule; bidId: string | null; opportunityId: string; facts: ScopeFacts }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The guard runs BEFORE zod validates the input, so every loader refuses a non-uuid instead of letting Postgres throw. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

const NO_ASSIGNED = { presales: null, legal: null, bid: null } as const
const lower = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null)
const today = () => new Date().toISOString().slice(0, 10)

/** Sales people who "own" these entities today: effective owner (with the same inheritance the grid's Bid Owner
 *  column uses), active delegate, and active solution lead. */
async function ownerIds(entities: { type: string; id: string }[]): Promise<string[]> {
  const { assignments, ctx } = await loadOwnershipContext()
  const asOf = today()
  const ids = new Set<string>()
  for (const { type, id } of entities) {
    const owner = effectiveOwner(assignments, type, id, asOf, ctx)
    if (owner) ids.add(owner.salesPersonId)
    const delegate = activeDelegate(assignments, type, id, asOf)
    if (delegate) ids.add(delegate.salesPersonId)
    for (const a of assignments) {
      if (a.entityType === type && a.entityId === id && a.role === 'solutionLead' && a.startDate <= asOf && (a.endDate === null || asOf < a.endDate)) {
        ids.add(a.salesPersonId)
      }
    }
  }
  return [...ids]
}

async function target(by: 'bid' | 'opportunity', id: unknown): Promise<RowTarget | null> {
  if (!isUuid(id)) return null
  const row = (await pool.query(
    `SELECT b.id AS bid_id, b.sheet, o.id AS opp_id, o.created_by, o.geo_sales_person_id, o.bu_sales_person_id,
            o.pre_sales_person_id, o.legal_person_id, o.bid_team_member_id
       FROM opportunities o LEFT JOIN bids b ON b.opportunity_id = o.id
      WHERE ${by === 'bid' ? 'b.id' : 'o.id'} = $1`, [id],
  )).rows[0]
  if (!row) return null
  // The row's own entity: the bid when there is one (its effective owner inherits from the opportunity), else the opportunity.
  const owners = await ownerIds([row.bid_id ? { type: 'bid', id: row.bid_id } : { type: 'opportunity', id: row.opp_id }])
  return {
    module: sheetModule(row.sheet),
    bidId: row.bid_id ?? null,
    opportunityId: row.opp_id,
    facts: {
      salesOwnerIds: [...new Set([...owners, row.geo_sales_person_id, row.bu_sales_person_id].filter(Boolean) as string[])],
      createdBy: lower(row.created_by),
      assigned: { presales: row.pre_sales_person_id ?? null, legal: row.legal_person_id ?? null, bid: row.bid_team_member_id ?? null },
    },
  }
}
export const rowForBid = (id: unknown) => target('bid', id)
export const rowForOpportunity = (id: unknown) => target('opportunity', id)

/** Rows for the polymorphic `entityType` / `entityId` pairs on ownership, follow-ups, documents, protected values. */
export async function rowForOwnedEntity(entityType: unknown, entityId: unknown): Promise<ScopeFacts | null> {
  if (!isUuid(entityId)) return null
  if (entityType === 'bid') return (await rowForBid(entityId))?.facts ?? null
  if (entityType === 'opportunity') return (await rowForOpportunity(entityId))?.facts ?? null
  if (entityType === 'contact' || entityType === 'orgNode') {
    return { salesOwnerIds: await ownerIds([{ type: entityType, id: entityId }]), createdBy: null, assigned: NO_ASSIGNED }
  }
  return null
}

export async function rowForSalesPerson(id: unknown): Promise<ScopeFacts | null> {
  return isUuid(id) ? { salesOwnerIds: [id], createdBy: null, assigned: NO_ASSIGNED } : null
}

export async function rowForFollowUp(id: unknown): Promise<{ entityType: string; entityId: string; facts: ScopeFacts } | null> {
  if (!isUuid(id)) return null
  const row = (await pool.query(`SELECT entity_type, entity_id, assignee_id, created_by FROM follow_ups WHERE id=$1`, [id])).rows[0]
  if (!row) return null
  const owners = row.entity_type === 'contact' ? await ownerIds([{ type: 'contact', id: row.entity_id }]) : []
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    facts: { salesOwnerIds: [...owners, ...(row.assignee_id ? [row.assignee_id] : [])], createdBy: lower(row.created_by), assigned: NO_ASSIGNED },
  }
}

export async function rowForTimelineEvent(id: unknown): Promise<ScopeFacts | null> {
  if (!isUuid(id)) return null
  const row = (await pool.query(`SELECT employee_id, attendees, created_by FROM timeline_events WHERE id=$1`, [id])).rows[0]
  if (!row) return null
  const attendees: unknown[] = Array.isArray(row.attendees) ? row.attendees : []
  const attendeeIds = attendees.map((a) => (typeof a === 'object' && a !== null ? (a as any).salesPersonId : null)).filter(Boolean) as string[]
  const owners = await ownerIds([{ type: 'contact', id: row.employee_id }])
  return { salesOwnerIds: [...new Set([...attendeeIds, ...owners])], createdBy: lower(row.created_by), assigned: NO_ASSIGNED }
}

export async function rowForDocument(id: unknown): Promise<ScopeFacts | null> {
  if (!isUuid(id)) return null
  const doc = (await pool.query(`SELECT entity_type, entity_id FROM documents WHERE id=$1`, [id])).rows[0]
  return doc ? rowForOwnedEntity(doc.entity_type, doc.entity_id) : null
}

export async function rowForCitation(id: unknown): Promise<ScopeFacts | null> {
  if (!isUuid(id)) return null
  const c = (await pool.query(`SELECT document_id FROM document_citations WHERE id=$1`, [id])).rows[0]
  return c ? rowForDocument(c.document_id) : null
}

export async function milestoneInfo(id: unknown): Promise<{ bidId: string; key: string } | null> {
  if (!isUuid(id)) return null
  const m = (await pool.query(`SELECT bid_id, key FROM bid_milestones WHERE id=$1`, [id])).rows[0]
  return m ? { bidId: m.bid_id, key: m.key } : null
}

export async function corrigendumChangeInfo(changeId: unknown): Promise<{ bidId: string; fieldKey: string } | null> {
  if (!isUuid(changeId)) return null
  const r = (await pool.query(
    `SELECT c.bid_id, ch.field_key FROM bid_corrigendum_changes ch JOIN bid_corrigenda c ON c.id = ch.corrigendum_id WHERE ch.id=$1`, [changeId],
  )).rows[0]
  return r ? { bidId: r.bid_id, fieldKey: r.field_key } : null
}

export async function assignmentInfo(id: unknown): Promise<{ entityType: string; entityId: string; role: string } | null> {
  if (!isUuid(id)) return null
  const a = (await pool.query(`SELECT entity_type, entity_id, role FROM ownership_assignments WHERE id=$1`, [id])).rows[0]
  return a ? { entityType: a.entity_type, entityId: a.entity_id, role: a.role } : null
}

export async function savedViewScope(id: unknown): Promise<'global' | 'personal' | null> {
  if (!isUuid(id)) return null
  const v = (await pool.query(`SELECT scope FROM bid_saved_views WHERE id=$1`, [id])).rows[0]
  return v ? (v.scope === 'global' ? 'global' : 'personal') : null
}

export async function domainOfNode(id: unknown): Promise<'geo' | 'org' | 'sales' | null> {
  if (!isUuid(id)) return null
  const n = (await pool.query(`SELECT domain FROM hierarchy_nodes WHERE id=$1`, [id])).rows[0]
  return n ? n.domain : null
}

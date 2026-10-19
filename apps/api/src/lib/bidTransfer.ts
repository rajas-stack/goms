import { z } from 'zod'
import { accessFor, allows, bidTransferFields, resolveBidTransferField, generalToDocument, formatBidCode, scaleBidAmount, validateBidTransfer, type BidImportPreview, type BidImportTable, type BidImportResult, type BidTransferContext, type CustomFieldType, type UserFacts } from '@goms/domain'
import { pool } from '../db.js'
import { applyStageChange, insertOpportunity } from '../routers/opportunities.js'
import { customValueColumns } from './customFieldValues.js'
import { writeAuditLog } from './auditLog.js'
import { loadUserFacts } from '../auth/rbac/userFacts.js'

export const bidTransferSchema = z.object({ table: z.object({
  headers: z.array(z.string().max(1000)).max(100),
  rows: z.array(z.array(z.union([z.string().max(50000), z.number().finite(), z.boolean(), z.null()])).max(100)).max(1000),
  cellIssues: z.array(z.object({ row: z.number().int().min(1), column: z.number().int().min(0), message: z.string().max(1000) })).max(100000).optional(),
}).strict() }).strict()
type Client = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }
export async function loadBidTransferContext(client: Client): Promise<BidTransferContext> {
  const existing = (await client.query('SELECT opportunity_name, gem_tender_id FROM opportunities')).rows
  const persons = (await client.query("SELECT id, name, official_email, mobile FROM sales_persons WHERE status <> 'inactive' AND status <> 'resigned'")).rows
  const teams = (await client.query("SELECT id, name, email, team FROM delivery_team_members WHERE status='active'")).rows
  const nodes = (await client.query("SELECT id, name, type_key, state_code FROM hierarchy_nodes WHERE status='active' AND (type_key='state' OR (domain='org' AND type_key='department'))")).rows
  const custom = (await client.query("SELECT id, key, name, data_type, options FROM bid_custom_fields WHERE status='active' AND sheet IN ('bidTracker','master')")).rows
  return {
    existing: existing.map(o => ({ opportunityName: o.opportunity_name, gemTenderId: o.gem_tender_id ?? '' })),
    people: [...persons.map(p => ({ id: p.id, name: p.name, email: p.official_email, mobile: p.mobile, team: 'sales' })), ...teams],
    states: nodes.filter(n => n.type_key === 'state').map(n => ({ id: String(n.state_code), name: n.name })),
    departments: nodes.filter(n => n.type_key === 'department').map(n => ({ id: n.id, name: n.name, stateCode: n.state_code })),
    customFields: custom.map(f => ({ id: f.id, key: f.key, name: f.name, dataType: f.data_type as CustomFieldType, options: f.options })),
  }
}
function validateForUser(table: BidImportTable, context: BidTransferContext, user: UserFacts): BidImportPreview {
  const preview = validateBidTransfer(table, context)
  if (!preview.valid) return preview
  const fields = bidTransferFields(context), rows = table.rows.map((cells, i) => ({ cells, row: i + 2 })).filter(r => r.cells.some(v => v !== null && String(v).trim()))
  preview.prepared.forEach(({ values: v }, i) => {
    const row = { createdBy: user.email, salesOwnerIds: [v.geoSalesPersonId, v.buSalesPersonId].filter(Boolean).map(String), assigned: { presales: v.preSalesPersonId ? String(v.preSalesPersonId) : null, bid: v.bidTeamMemberId ? String(v.bidTeamMemberId) : null, legal: null } }
    table.headers.forEach((header, column) => {
      const id = resolveBidTransferField(header, fields)?.id
      if (!id || v[id] === undefined) return
      const atom = id === 'stageKey' ? 'bid.stage' : id === 'decision' ? 'bid.decision' : id === 'ownerEmail' ? 'ownership.bidEntity' : id.startsWith('custom:') ? 'bid.custom' : null
      if (!atom && !id.startsWith('general:')) return
      const access = accessFor(user, id === 'ownerEmail' ? 'am.ownership' : 'opp.bidTracker', row)
      if ((access.level !== 'W' && access.level !== 'P') || (atom ? !allows(access, atom) : !access.all)) preview.issues.push({ row: rows[i].row, column, message: 'Your app permissions do not allow setting this field. Ask an authorized bid owner or administrator to import it.' })
    })
  })
  preview.valid = !preview.issues.length
  if (!preview.valid) preview.prepared = []
  return preview
}
export async function previewBidTransfer(table: BidImportTable, actor: string) { return validateForUser(table, await loadBidTransferContext(pool), await loadUserFacts(actor)) }

export async function commitBidTransfer(table: BidImportTable, actor: string | null): Promise<BidImportResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query('LOCK TABLE hierarchy_nodes, sales_persons, delivery_team_members IN SHARE MODE')
    await client.query('LOCK TABLE opportunities, bids, bid_custom_fields IN SHARE ROW EXCLUSIVE MODE')
    const context = await loadBidTransferContext(client), preview = validateForUser(table, context, await loadUserFacts(actor ?? ''))
    if (!preview.valid) { await client.query('ROLLBACK'); return { status: 'rejected', preview } }
    for (const { values: v } of preview.prepared) {
      const text = (key: string) => v[key] == null ? '' : String(v[key])
      const dept = text('departmentId') || null
      const opportunity = await insertOpportunity(client, {
        departmentId: dept, opportunityName: text('opportunityName'), gemTenderId: text('gemTenderId'),
        assignmentName: text('assignmentName'), referenceNo: text('referenceNo'), opportunityType: text('opportunityType'),
        publishDate: text('publishDate'), submissionDate: text('submissionDate'), vertical: text('vertical'),
        valueAmount: text('valueAmount'), valueUnit: 'cr', currency: 'INR',
        emdAmount: scaleBidAmount(text('emdAmount'), -3), emdUnit: 'thousand',
        geoSalesPersonId: text('geoSalesPersonId') || null, buSalesPersonId: text('buSalesPersonId') || null,
        preSalesPersonId: text('preSalesPersonId') || null, bidTeamMemberId: text('bidTeamMemberId') || null,
      }, { deferCode: !dept, createdBy: actor })
      if (!dept && v.stateCode !== undefined) await client.query('UPDATE opportunities SET state_code=$1 WHERE id=$2', [Number(v.stateCode), opportunity.id])
      const year = new Date().getFullYear()
      const number = (await client.query(`INSERT INTO bid_number_sequences (year, next_value) VALUES ($1,2)
        ON CONFLICT (year) DO UPDATE SET next_value=bid_number_sequences.next_value+1 RETURNING next_value-1 AS allocated`, [year])).rows[0].allocated
      const decision = text('decision') || 'pending'
      const stage = decision === 'no_go' ? 'dropped' : decision === 'go' ? 'goApproved' : text('stageKey') || 'solutioning'
      const bid = (await client.query(`INSERT INTO bids (opportunity_id,bid_code,stage_key,decision,tender_link,sheet,data_confidence)
        VALUES ($1,$2,$3,$4,$5,'bidTracker','needs_review') RETURNING id`, [opportunity.id, formatBidCode(year, number), stage, decision, text('tenderLink') || null])).rows[0]
      if (decision === 'go' || decision === 'no_go' || stage === 'submitted') await applyStageChange(client, opportunity.id, decision === 'go' ? 'won' : decision === 'no_go' ? 'dropped' : 'submitted', 'Initial imported bid stage')
      await client.query(`INSERT INTO bid_milestones (bid_id,milestone_type,key,label,due_at,source)
        VALUES ($1,'submissionDeadline','submissionDeadline','Submission Deadline',$2,'manual')`, [bid.id, text('submissionDate') || null])
      const general = Object.fromEntries(Object.entries(v).filter(([key]) => key.startsWith('general:')).map(([key,value]) => [key.slice(8), String(value ?? '')]))
      if (Object.keys(general).length) await client.query(`INSERT INTO bid_synopsis_sections (bid_id,section,document,revision,updated_by)
        VALUES ($1,'general',$2,1,$3)`, [bid.id, JSON.stringify(generalToDocument(general)), actor])
      for (const field of context.customFields) {
        const value = v[`custom:${field.key}`]
        if (value === undefined || value === null) continue
        const stored = customValueColumns(field.dataType, value)
        await client.query(`INSERT INTO bid_custom_field_values (bid_id,field_id,value_text,value_number,value_date,value_bool)
          VALUES ($1,$2,$3,$4,$5,$6)`, [bid.id, field.id, stored.text, stored.number, stored.date, stored.bool])
        await client.query('UPDATE bid_custom_fields SET has_held_value=true WHERE id=$1 AND NOT has_held_value', [field.id])
      }
      if (text('ownerEmail')) {
        const owner = context.people.find(p => p.team === 'sales' && p.email === text('ownerEmail'))!
        await client.query(`INSERT INTO ownership_assignments (entity_type,entity_id,sales_person_id,role,start_date)
          VALUES ('bid',$1,$2,'owner',CURRENT_DATE)`, [bid.id, owner.id])
      }
      await writeAuditLog(client, { entityType: 'bid', entityId: bid.id, field: 'import', oldValue: '', newValue: formatBidCode(year, number), action: 'create', reason: 'Validated whole-file import', changedBy: actor })
    }
    await client.query('COMMIT')
    return { status: 'imported', count: preview.rowCount }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

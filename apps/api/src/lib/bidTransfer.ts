import { z } from 'zod'
import { BID_LEGACY_AUDIT_FIELD, accessFor, allows, bidTransferFields, bidImportTarget,generalToDocument, documentToGeneral, updateGeneralDocument, formatBidCode, scaleBidAmount, validateBidTransfer, type BidImportPreview, type BidImportTable, type PreparedBidImport, type BidImportResult, type BidTransferContext, type CustomFieldType, type UserFacts } from '@goms/domain'
import { pool } from '../db.js'
import { withLiveOptions } from './bidOptionLookups.js'
import { applyStageChange, insertOpportunity } from '../routers/opportunities.js'
import { customValueColumns } from './customFieldValues.js'
import { writeAuditLog } from './auditLog.js'
import { loadUserFacts } from '../auth/rbac/userFacts.js'

export const bidTransferSchema = z.object({ table: z.object({
  headers: z.array(z.string().max(1000)).max(100),
  rows: z.array(z.array(z.union([z.string().max(50000), z.number().finite(), z.boolean(), z.null()])).max(100)).max(1000),
  cellIssues: z.array(z.object({ row: z.number().int().min(1), column: z.number().int().min(0), message: z.string().max(1000) })).max(100000).optional(),
  mapping: z.array(z.string().max(200).nullable()).max(100).optional(),
  rowActions: z.record(z.string().regex(/^\d{1,4}$/), z.enum(['skip', 'add', 'override'])).optional(),
}).strict() }).strict()
type Client = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }
export async function loadBidTransferContext(client: Client): Promise<BidTransferContext> {
  const existing = (await client.query(`SELECT o.*, b.bid_code, b.stage_key AS bid_stage_key, b.decision, b.tender_link, s.document
    FROM opportunities o LEFT JOIN bids b ON b.opportunity_id=o.id
    LEFT JOIN bid_synopsis_sections s ON s.bid_id=b.id AND s.section='general'`)).rows
  const persons = (await client.query("SELECT id, name, official_email, mobile FROM sales_persons WHERE status <> 'inactive' AND status <> 'resigned'")).rows
  const teams = (await client.query("SELECT id, name, email, team FROM delivery_team_members WHERE status='active'")).rows
  const nodes = (await client.query("SELECT id, name, type_key, state_code FROM hierarchy_nodes WHERE status='active' AND (type_key='state' OR (domain='org' AND type_key='department'))")).rows
  const custom = (await client.query("SELECT id, key, name, data_type, options FROM bid_custom_fields WHERE status='active' AND sheet IN ('bidTracker','master')")).rows
  return {
    existing: existing.map(o => ({ id: o.id, bidCode: o.bid_code ?? undefined, opportunityName: o.opportunity_name, gemTenderId: o.gem_tender_id ?? '', current: currentValues(o) })),
    people: [...persons.map(p => ({ id: p.id, name: p.name, email: p.official_email, mobile: p.mobile, team: 'sales' })), ...teams],
    states: nodes.filter(n => n.type_key === 'state').map(n => ({ id: String(n.state_code), name: n.name })),
    departments: nodes.filter(n => n.type_key === 'department').map(n => ({ id: n.id, name: n.name, stateCode: n.state_code })),
    customFields: await withLiveOptions(client, custom.map(f => ({ id: f.id, key: f.key, name: f.name, dataType: f.data_type as CustomFieldType, options: f.options }))),
    verticals: (await client.query("SELECT name FROM commercial_masters WHERE master_key='verticals' AND active ORDER BY display_order, name")).rows.map(r => r.name),
  }
}
/** Power of ten from a stored unit to the import unit (crore for value, rupees for EMD). */
const TO_CRORE: Record<string, number> = { cr: 0, crore: 0, lakh: -2, thousand: -4 }
const TO_RUPEE: Record<string, number> = { cr: 7, crore: 7, lakh: 5, thousand: 3 }
/** Import field id → opportunities column, for fields an Override may update. */
const OPPORTUNITY_COLUMNS: Record<string, string> = {
  opportunityName: 'opportunity_name', gemTenderId: 'gem_tender_id', assignmentName: 'assignment_name', referenceNo: 'reference_no',
  opportunityType: 'opportunity_type', publishDate: 'publish_date', submissionDate: 'submission_date', vertical: 'vertical',
  departmentId: 'department_id', stateCode: 'state_code', geoSalesPersonId: 'geo_sales_person_id', buSalesPersonId: 'bu_sales_person_id',
  preSalesPersonId: 'pre_sales_person_id', bidTeamMemberId: 'bid_team_member_id',
}
/** Existing opportunity + bid values keyed by import field id, for the Override diff. */
function currentValues(o: any): Record<string, string> {
  const s = (v: unknown) => v == null ? '' : String(v)
  const out: Record<string, string> = {}
  for (const [field, column] of Object.entries(OPPORTUNITY_COLUMNS)) out[field] = s(o[column])
  if (o.value_amount) out.valueAmount = scaleBidAmount(s(o.value_amount), TO_CRORE[o.value_unit] ?? 0)
  if (o.emd_amount) out.emdAmount = scaleBidAmount(s(o.emd_amount), TO_RUPEE[o.emd_unit] ?? 0)
  out.createdBy = s(o.created_by)
  out.stageKey = s(o.bid_stage_key); out.decision = s(o.decision); out.tenderLink = s(o.tender_link)
  for (const [key, value] of Object.entries(documentToGeneral(o.document))) out[`general:${key}`] = value
  return out
}
/** Override: update the matched opportunity/bid in place (Bid ID kept). Only fields the file provides change;
 *  blank cells never clear a value. Every change is audited with its old value. */
async function overrideBid(client: Client, targetId: string, v: PreparedBidImport['values'], legacy: Record<string, string>, context: BidTransferContext, actor: string | null) {
  const text = (key: string) => v[key] == null ? '' : String(v[key])
  const old = context.existing.find(o => o.id === targetId)?.current ?? {}
  const changed: [string, string, string][] = []
  const sets: string[] = [], params: unknown[] = []
  const set = (column: string, value: unknown) => { params.push(value); sets.push(`${column}=${params.length}`) }
  for (const [field, column] of Object.entries(OPPORTUNITY_COLUMNS)) {
    if (!text(field)) continue
    set(column, field === 'stateCode' ? Number(text(field)) : text(field))
    changed.push([field, old[field] ?? '', text(field)])
  }
  if (text('valueAmount')) { set('value_amount', text('valueAmount')); set('value_unit', 'cr'); changed.push(['valueAmount', old.valueAmount ?? '', text('valueAmount')]) }
  if (text('emdAmount')) { set('emd_amount', scaleBidAmount(text('emdAmount'), -3)); set('emd_unit', 'thousand'); changed.push(['emdAmount', old.emdAmount ?? '', text('emdAmount')]) }
  if (sets.length) { params.push(targetId); await client.query(`UPDATE opportunities SET ${sets.join(', ')} WHERE id=${params.length}`, params) }
  const bid = (await client.query('SELECT id FROM bids WHERE opportunity_id=$1', [targetId])).rows[0]
  if (bid) {
    const bidSets: string[] = [], bidParams: unknown[] = []
    for (const [field, column] of [['stageKey', 'stage_key'], ['decision', 'decision'], ['tenderLink', 'tender_link']] as const) {
      if (!text(field)) continue
      bidParams.push(text(field)); bidSets.push(`${column}=${bidParams.length}`)
      changed.push([field, old[field] ?? '', text(field)])
    }
    if (bidSets.length) { bidParams.push(bid.id); await client.query(`UPDATE bids SET ${bidSets.join(', ')} WHERE id=${bidParams.length}`, bidParams) }
    if (text('submissionDate')) await client.query("UPDATE bid_milestones SET due_at=$2 WHERE bid_id=$1 AND key='submissionDeadline'", [bid.id, text('submissionDate')])
    const general = Object.entries(v).filter(([key, value]) => key.startsWith('general:') && String(value ?? '').trim())
    if (general.length) {
      const row = (await client.query("SELECT document FROM bid_synopsis_sections WHERE bid_id=$1 AND section='general'", [bid.id])).rows[0]
      let doc = row?.document ?? null
      for (const [key, value] of general) { doc = updateGeneralDocument(doc, key.slice(8), String(value)); changed.push([key, old[key] ?? '', String(value)]) }
      if (row) await client.query("UPDATE bid_synopsis_sections SET document=$2, revision=revision+1, updated_by=$3 WHERE bid_id=$1 AND section='general'", [bid.id, JSON.stringify(doc), actor])
      else await client.query("INSERT INTO bid_synopsis_sections (bid_id,section,document,revision,updated_by) VALUES ($1,'general',$2,1,$3)", [bid.id, JSON.stringify(doc), actor])
    }
    for (const field of context.customFields) {
      const value = v[`custom:${field.key}`]
      if (value === undefined || value === null || value === '') continue
      const stored = customValueColumns(field.dataType, value)
      await client.query('DELETE FROM bid_custom_field_values WHERE bid_id=$1 AND field_id=$2', [bid.id, field.id])
      await client.query(`INSERT INTO bid_custom_field_values (bid_id,field_id,value_text,value_number,value_date,value_bool)
        VALUES ($1,$2,$3,$4,$5,$6)`, [bid.id, field.id, stored.text, stored.number, stored.date, stored.bool])
      await client.query('UPDATE bid_custom_fields SET has_held_value=true WHERE id=$1 AND NOT has_held_value', [field.id])
      changed.push([`custom:${field.key}`, '', String(value)])
    }
  }
  const entityId = bid?.id ?? targetId, entityType = bid ? 'bid' : 'opportunity'
  for (const [field, oldValue, newValue] of changed) {
    if (oldValue !== newValue) await writeAuditLog(client, { entityType, entityId, field, oldValue, newValue, action: 'update', reason: 'Import override (user confirmed)', changedBy: actor })
  }
  if (Object.keys(legacy).length) await writeAuditLog(client, { entityType, entityId, field: BID_LEGACY_AUDIT_FIELD, oldValue: '', newValue: JSON.stringify(legacy), action: 'update', reason: 'Historical import values without an app field', changedBy: actor })
}
function validateForUser(table: BidImportTable, context: BidTransferContext, user: UserFacts): BidImportPreview {
  const preview = validateBidTransfer(table, context)
  if (!preview.valid) return preview
  const fields = bidTransferFields(context), rows = table.rows.map((cells, i) => ({ cells, row: i + 2 })).filter(r => r.cells.some(v => v !== null && String(v).trim()))
  preview.prepared.forEach(({ values: v, mode, targetId, row: excelRow }, i) => {
    if (mode === 'override') {
      // Override edits an existing record: the user needs write access to THAT record.
      const live = context.existing.find(o => o.id === targetId)?.current ?? {}
      const facts = { createdBy: live.createdBy ?? '', salesOwnerIds: [live.geoSalesPersonId, live.buSalesPersonId].filter(Boolean), assigned: { presales: live.preSalesPersonId || null, bid: live.bidTeamMemberId || null, legal: null } }
      const access = accessFor(user, 'opp.bidTracker', facts)
      if (access.level !== 'W' && access.level !== 'P') preview.issues.push({ row: excelRow ?? rows[i].row, column: 0, message: 'You cannot edit this existing bid, so Override is not allowed. Choose Skip or Add as duplicate.' })
    }
    const row = { createdBy: user.email, salesOwnerIds: [v.geoSalesPersonId, v.buSalesPersonId].filter(Boolean).map(String), assigned: { presales: v.preSalesPersonId ? String(v.preSalesPersonId) : null, bid: v.bidTeamMemberId ? String(v.bidTeamMemberId) : null, legal: null } }
    table.headers.forEach((_, column) => {
      const id = bidImportTarget(table, column, fields)?.id
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
    for (const { values: v, legacy, mode, targetId } of preview.prepared) {
      if (mode === 'override' && targetId) { await overrideBid(client, targetId, v, legacy, context, actor); continue }
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
      // Historical tracker columns with no app field (or values that could not be linked) stay with the bid.
      if (Object.keys(legacy).length) await writeAuditLog(client, { entityType: 'bid', entityId: bid.id, field: BID_LEGACY_AUDIT_FIELD, oldValue: '', newValue: JSON.stringify(legacy), action: 'create', reason: 'Historical import values without an app field', changedBy: actor })
    }
    await client.query('COMMIT')
    return { status: 'imported', count: preview.rowCount }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

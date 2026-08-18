import { isoToday } from '@/lib/dates'
import type { FollowUp, Opportunity, OpportunityStageChange, OwnershipAssignment } from '@/lib/types'
import { DEFAULT_STAGE_KEY, PIPELINE_STAGE_MAP } from '../pipeline-stages'
import {
  buildOwnerMap, effectiveOwner, OWNABLE_ENTITY_MAP, type OwnerResolution, type OwnershipContext,
} from '../ownership'
import type {
  AssignOwnerInput, CreateFollowUpInput, CreateOpportunityInput, TransferBookOfBusinessInput,
} from '../in-memory/repository'
import { rowToHierNode } from './hierarchy'
import { toEmployees } from './employees'
import { supabase } from './client'
import type { Database } from './database.types'

type OpportunityRow = Database['public']['Tables']['opportunities']['Row'] & {
  departments: { state_code: number | null } | null
  sales_people: { official_email: string } | null
}
type StageChangeRow = Database['public']['Tables']['opportunity_stage_changes']['Row']
type FollowUpRow = Database['public']['Tables']['follow_ups']['Row']
type OwnershipRow = Database['public']['Tables']['ownership_assignments']['Row']

const OPP_SELECT = '*, departments(state_code), sales_people(official_email)'

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id, departmentId: row.department_id, stateCode: row.departments?.state_code ?? null,
    stageKey: row.stage_key, closedOn: row.closed_on,
    opportunityName: row.opportunity_name, gemTenderId: row.gem_tender_id,
    publishDate: row.publish_date ?? '', submissionDate: row.submission_date ?? '',
    vertical: row.vertical, component: row.component ?? [], quantity: row.quantity,
    currency: row.currency, valueAmount: row.value_amount, valueUnit: row.value_unit,
    budgetKnown: row.budget_known, emdAmount: row.emd_amount, emdUnit: row.emd_unit,
    salesPersonEmail: row.sales_people?.official_email ?? '',
    createdAt: row.created_at, createdBy: row.created_by,
  }
}

function toStageChange(row: StageChangeRow): OpportunityStageChange {
  return { id: row.id, opportunityId: row.opportunity_id, fromStageKey: row.from_stage_key, toStageKey: row.to_stage_key, changedAt: row.changed_at, changedBy: row.changed_by, note: row.note }
}

function toFollowUp(row: FollowUpRow): FollowUp {
  return { id: row.id, entityType: row.entity_type, entityId: row.entity_id, assigneeId: row.assignee_id, dueDate: row.due_date, status: row.status as FollowUp['status'], note: row.note, createdAt: row.created_at, createdBy: row.created_by }
}

function toOwnershipAssignment(row: OwnershipRow): OwnershipAssignment {
  return { id: row.id, entityType: row.entity_type, entityId: row.entity_id, salesPersonId: row.sales_person_id, role: row.role, startDate: row.start_date, endDate: row.end_date, reason: row.reason as OwnershipAssignment['reason'], batchId: row.batch_id, note: row.note, createdAt: row.created_at, createdBy: row.created_by }
}

async function resolveSalesPersonId(email: string | undefined): Promise<string | null> {
  if (!email) return null
  const { data } = await supabase.from('sales_people').select('id').eq('official_email', email).limit(1)
  return data?.[0]?.id ?? null
}

export async function createOpportunity(input: CreateOpportunityInput): Promise<Opportunity> {
  const stageKey = input.stageKey ?? DEFAULT_STAGE_KEY
  const row = {
    department_id: input.departmentId, stage_key: stageKey,
    closed_on: PIPELINE_STAGE_MAP[stageKey]?.isClosed ? isoToday() : null,
    opportunity_name: input.opportunityName, gem_tender_id: input.gemTenderId ?? '',
    publish_date: input.publishDate || null, submission_date: input.submissionDate || null,
    vertical: input.vertical ?? '', component: input.component ?? [], quantity: input.quantity ?? '',
    currency: input.currency ?? 'INR', value_amount: input.valueAmount ?? '', value_unit: input.valueUnit ?? 'lakh',
    budget_known: input.budgetKnown ?? '', emd_amount: input.emdAmount ?? '', emd_unit: input.emdUnit ?? 'lakh',
    sales_person_id: await resolveSalesPersonId(input.salesPersonEmail),
  }
  const { data, error } = await supabase.from('opportunities').insert(row).select(OPP_SELECT).single()
  if (error) throw error

  const { error: stageErr } = await supabase.from('opportunity_stage_changes').insert({
    opportunity_id: data.id, from_stage_key: null, to_stage_key: stageKey, changed_at: isoToday(), note: 'Opportunity created',
  })
  if (stageErr) throw stageErr
  return toOpportunity(data as OpportunityRow)
}

const OPP_PATCHABLE: [string, string][] = [
  ['opportunityName', 'opportunity_name'], ['gemTenderId', 'gem_tender_id'], ['publishDate', 'publish_date'],
  ['submissionDate', 'submission_date'], ['vertical', 'vertical'], ['component', 'component'], ['quantity', 'quantity'],
  ['currency', 'currency'], ['valueAmount', 'value_amount'], ['valueUnit', 'value_unit'], ['budgetKnown', 'budget_known'],
  ['emdAmount', 'emd_amount'], ['emdUnit', 'emd_unit'], ['departmentId', 'department_id'],
]

export async function updateOpportunity(id: string, patch: Partial<Opportunity>): Promise<Opportunity> {
  const { data: existingRows, error: existErr } = await supabase.from('opportunities').select('*').eq('id', id).limit(1)
  if (existErr) throw existErr
  const existing = existingRows[0]
  if (!existing) throw new Error(`No such opportunity: ${id}`)
  const previousStage = existing.stage_key

  const update: Record<string, unknown> = {}
  const patchRecord = patch as Record<string, unknown>
  for (const [tsField, dbColumn] of OPP_PATCHABLE) if (patchRecord[tsField] !== undefined) update[dbColumn] = patchRecord[tsField]
  if (patch.stageKey !== undefined) update.stage_key = patch.stageKey
  if (patch.salesPersonEmail !== undefined) update.sales_person_id = await resolveSalesPersonId(patch.salesPersonEmail)

  let stageChanged = false
  if (patch.stageKey !== undefined && patch.stageKey !== previousStage) {
    stageChanged = true
    const nowClosed = PIPELINE_STAGE_MAP[patch.stageKey]?.isClosed ?? false
    update.closed_on = nowClosed ? existing.closed_on ?? isoToday() : null
  }

  const { data, error } = await supabase.from('opportunities').update(update as never).eq('id', id).select(OPP_SELECT).single()
  if (error) throw error

  if (stageChanged) {
    const { error: stageErr } = await supabase.from('opportunity_stage_changes').insert({
      opportunity_id: id, from_stage_key: previousStage, to_stage_key: patch.stageKey!, changed_at: isoToday(), note: '',
    })
    if (stageErr) throw stageErr
  }
  return toOpportunity(data as OpportunityRow)
}

export async function deleteOpportunity(id: string): Promise<void> {
  // opportunity_stage_changes cascades via its own FK (Phase 1). ownership_assignments/
  // follow_ups for entityType='opportunity' are NOT cascaded — faithful port of the
  // in-memory gap (Global Constraints notes this class of asymmetry throughout).
  const { error } = await supabase.from('opportunities').delete().eq('id', id)
  if (error) throw error
}

export async function createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {
  const row = { entity_type: input.entityType, entity_id: input.entityId, assignee_id: input.assigneeId ?? null, due_date: input.dueDate, status: 'open', note: input.note ?? '' }
  const { data, error } = await supabase.from('follow_ups').insert(row).select('*').single()
  if (error) throw error
  return toFollowUp(data)
}

export async function setFollowUpStatus(id: string, status: FollowUp['status']): Promise<void> {
  const { error } = await supabase.from('follow_ups').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteFollowUp(id: string): Promise<void> {
  const { error } = await supabase.from('follow_ups').delete().eq('id', id)
  if (error) throw error
}

export async function assignOwner(input: AssignOwnerInput): Promise<OwnershipAssignment> {
  if (!OWNABLE_ENTITY_MAP[input.entityType]) throw new Error(`Not an ownable entity type: ${input.entityType}`)
  const { data, error } = await supabase.rpc('assign_owner', {
    p_entity_type: input.entityType, p_entity_id: input.entityId, p_sales_person_id: input.salesPersonId,
    p_role: input.role ?? 'owner', p_start_date: input.startDate,
    // Generated Args type says `string`, not `string | null` — `supabase gen
    // types` doesn't mark plpgsql function params nullable even though the
    // SQL declares `p_end_date date` with no NOT NULL. null is valid here.
    p_end_date: (input.endDate ?? null) as unknown as string,
    p_reason: input.reason ?? 'initial', p_note: input.note ?? '',
  })
  if (error) throw error
  return toOwnershipAssignment(data)
}

export async function endOwnership(id: string, endDate: string): Promise<void> {
  const { data, error } = await supabase.from('ownership_assignments').select('start_date').eq('id', id).limit(1)
  if (error) throw error
  const row = data[0]
  if (!row) return
  if (endDate <= row.start_date) throw new Error('An assignment cannot end on or before it starts')
  const { error: updErr } = await supabase.from('ownership_assignments').update({ end_date: endDate }).eq('id', id)
  if (updErr) throw updErr
}

export async function transferBookOfBusiness(input: TransferBookOfBusinessInput): Promise<OwnershipAssignment[]> {
  const { data, error } = await supabase.rpc('transfer_book_of_business', {
    p_from: input.fromSalesPersonId, p_to: input.toSalesPersonId, p_effective_date: input.effectiveDate, p_note: input.note ?? '',
  })
  if (error) throw error
  return (data ?? []).map(toOwnershipAssignment)
}

export async function listOpportunities(): Promise<Opportunity[]> {
  const { data, error } = await supabase.from('opportunities').select(OPP_SELECT)
    .order('created_at', { ascending: false }).order('opportunity_name', { ascending: true })
  if (error) throw error
  return (data as OpportunityRow[]).map(toOpportunity)
}

export async function listOpportunitiesByDepartment(departmentId: string): Promise<Opportunity[]> {
  const { data, error } = await supabase.from('opportunities').select(OPP_SELECT)
    .eq('department_id', departmentId).order('opportunity_name', { ascending: true })
  if (error) throw error
  return (data as OpportunityRow[]).map(toOpportunity)
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  const { data, error } = await supabase.from('opportunities').select(OPP_SELECT).eq('id', id).limit(1)
  if (error) throw error
  return data[0] ? toOpportunity(data[0] as OpportunityRow) : null
}

export async function listOpportunityStageChanges(opportunityId: string): Promise<OpportunityStageChange[]> {
  const { data, error } = await supabase.from('opportunity_stage_changes').select('*').eq('opportunity_id', opportunityId)
    .order('changed_at', { ascending: true }).order('id', { ascending: true })
  if (error) throw error
  return data.map(toStageChange)
}

export async function listFollowUps(entityType: string, entityId: string): Promise<FollowUp[]> {
  const { data, error } = await supabase.from('follow_ups').select('*')
    .eq('entity_type', entityType).eq('entity_id', entityId).order('due_date', { ascending: true })
  if (error) throw error
  return data.map(toFollowUp)
}

export async function listOpenFollowUps(): Promise<FollowUp[]> {
  const { data, error } = await supabase.from('follow_ups').select('*').eq('status', 'open').order('due_date', { ascending: true })
  if (error) throw error
  return data.map(toFollowUp)
}

export async function listOwnershipAssignments(): Promise<OwnershipAssignment[]> {
  const { data, error } = await supabase.from('ownership_assignments').select('*').order('start_date', { ascending: false })
  if (error) throw error
  return data.map(toOwnershipAssignment)
}

export async function listOwnershipFor(entityType: string, entityId: string): Promise<OwnershipAssignment[]> {
  const { data, error } = await supabase.from('ownership_assignments').select('*')
    .eq('entity_type', entityType).eq('entity_id', entityId).order('start_date', { ascending: false })
  if (error) throw error
  return data.map(toOwnershipAssignment)
}

export async function listOwnedBy(salesPersonId: string, asOf: string): Promise<OwnershipAssignment[]> {
  const { data, error } = await supabase.from('ownership_assignments').select('*')
    .eq('sales_person_id', salesPersonId).lte('start_date', asOf).or(`end_date.is.null,end_date.gt.${asOf}`)
  if (error) throw error
  return data.map(toOwnershipAssignment) // No sort — faithful port; the in-memory version applies none either.
}

/** ownership.ts's OwnershipContext only ever reads nodes[].id/.parentId,
 *  employees[].orgNodeId, and opportunities[].id/.departmentId (confirmed
 *  against its actual implementation) — the opportunities fetch below is
 *  deliberately narrower than the full Opportunity shape for that reason. */
async function buildOwnershipContext(): Promise<OwnershipContext> {
  const [{ data: depts, error: deptErr }, { data: employeeRows, error: empErr }, { data: opps, error: oppErr }] = await Promise.all([
    supabase.from('departments').select('*'),
    supabase.from('employees').select('*'),
    supabase.from('opportunities').select('id, department_id'),
  ])
  if (deptErr) throw deptErr
  if (empErr) throw empErr
  if (oppErr) throw oppErr
  const nodes = depts.map((d) => rowToHierNode('departments', d))
  const employees = await toEmployees(employeeRows)
  const opportunities = opps.map((o) => ({ id: o.id, departmentId: o.department_id }) as Opportunity)
  return { nodes, employees, opportunities }
}

export async function resolveOwner(entityType: string, entityId: string, asOf: string): Promise<OwnerResolution | null> {
  const [{ data: assignments, error }, ctx] = await Promise.all([
    supabase.from('ownership_assignments').select('*'), buildOwnershipContext(),
  ])
  if (error) throw error
  return effectiveOwner(assignments.map(toOwnershipAssignment), entityType, entityId, asOf, ctx)
}

export async function resolveOwners(entityType: string, entityIds: string[], asOf: string): Promise<Record<string, OwnerResolution>> {
  const [{ data: assignments, error }, ctx] = await Promise.all([
    supabase.from('ownership_assignments').select('*'), buildOwnershipContext(),
  ])
  if (error) throw error
  const map = buildOwnerMap(assignments.map(toOwnershipAssignment), entityType, entityIds, asOf, ctx)
  return Object.fromEntries(map)
}

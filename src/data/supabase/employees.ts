import { isoToday } from '@/lib/dates'
import type {
  Charge, Employee, MergeAuditRecord, MergeFieldResolution, PreferredComm, RelationshipQuality,
  RelationshipStatus, Status, TimelineEvent, TimelineEventType, Transfer,
} from '@/lib/types'
import type {
  AddTimelineInput, CreateEmployeeInput, ImportEmployeeRow, MergeEmployeesInput, TransferInput,
} from '../in-memory/repository'
import { supabase } from './client'
import { recordAuditLogEntry } from './audit-logs'
import type { Database } from './database.types'

type EmployeeRow = Database['public']['Tables']['employees']['Row']
type ChargeRow = Database['public']['Tables']['charges']['Row']
type TimelineEventRow = Database['public']['Tables']['timeline_events']['Row']
type TransferRow = Database['public']['Tables']['transfers']['Row']
type MergeAuditRow = Database['public']['Tables']['merge_audit_records']['Row']

function toCharge(row: ChargeRow): Charge {
  return { id: row.id, kind: row.kind as Charge['kind'], title: row.title, orgNodeId: row.department_id, startDate: row.start_date, endDate: row.end_date, reason: row.reason }
}

function toTimelineEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id, employeeId: row.employee_id, type: row.type as TimelineEventType, title: row.title,
    customLabel: row.custom_label ?? undefined, date: row.event_date, time: row.event_time ?? undefined,
    note: row.note, source: row.source as 'manual' | 'system',
    attendees: row.attendees ?? undefined, attended: row.attended ?? undefined,
  }
}

function toTransfer(row: TransferRow): Transfer {
  return {
    id: row.id, employeeId: row.employee_id, fromDesignation: row.from_designation, toDesignation: row.to_designation,
    fromDepartmentName: row.from_department_name, toDepartmentName: row.to_department_name,
    fromOfficeName: row.from_office_name, toOfficeName: row.to_office_name, toOrgNodeId: row.to_org_node_id!,
    fromManagerName: row.from_manager_name, toManagerName: row.to_manager_name,
    effectiveDate: row.effective_date, reason: row.reason, remarks: row.remarks,
  }
}

function toMergeAuditRecord(row: MergeAuditRow): MergeAuditRecord {
  return {
    id: row.id, survivorId: row.survivor_id, survivorName: row.survivor_name,
    duplicateId: row.duplicate_id, duplicateName: row.duplicate_name, mergedAt: row.merged_at,
    fieldResolutions: row.field_resolutions as unknown as MergeFieldResolution[],
    transferred: row.transferred as unknown as MergeAuditRecord['transferred'],
  }
}

async function chargesByEmployeeId(employeeIds: string[]): Promise<Map<string, ChargeRow[]>> {
  if (employeeIds.length === 0) return new Map()
  const { data, error } = await supabase.from('charges').select('*').in('employee_id', employeeIds)
  if (error) throw error
  const map = new Map<string, ChargeRow[]>()
  for (const row of data) map.set(row.employee_id, [...(map.get(row.employee_id) ?? []), row])
  return map
}

export async function toEmployees(rows: EmployeeRow[]): Promise<Employee[]> {
  const chargesMap = await chargesByEmployeeId(rows.map((r) => r.id))
  return rows.map((row) => ({
    id: row.id, code: row.code, name: row.name, designation: row.designation, email: row.email, phone: row.phone,
    company: row.company, address: row.address, website: row.website, photoUrl: row.photo_url,
    orgNodeId: row.department_id!, managerId: row.manager_id,
    vacant: row.vacant, connected: row.connected,
    relationshipStatus: row.relationship_status as RelationshipStatus,
    relationshipQuality: row.relationship_quality as RelationshipQuality,
    relationshipType: row.relationship_type, introducedBy: row.introduced_by,
    importantContact: row.important_contact, preferredComm: (row.preferred_comm ?? []) as PreferredComm[],
    lastInteractionAt: row.last_interaction_at, followUpDate: row.follow_up_date, notes: row.notes,
    charges: (chargesMap.get(row.id) ?? []).map(toCharge),
    visitingCards: [], // Storage-backed visiting cards are Phase 6 scope.
    metadata: (row.metadata ?? {}) as Record<string, string>,
    status: row.status as Status,
  }))
}

export async function listEmployeesUnder(orgNodeId: string): Promise<Employee[]> {
  const { data: ids, error: idsErr } = await supabase.rpc('department_subtree_ids', { p_id: orgNodeId })
  if (idsErr) throw idsErr
  const { data, error } = await supabase
    .from('employees').select('*').in('department_id', ids as unknown as string[]).eq('status', 'active')
    .order('name', { ascending: true })
  if (error) throw error
  return toEmployees(data)
}

export async function listEmployeesDirect(orgNodeId: string): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees').select('*').eq('department_id', orgNodeId).eq('status', 'active').order('name', { ascending: true })
  if (error) throw error
  return toEmployees(data)
}

export async function listEmployeesByState(stateCode: number): Promise<Employee[]> {
  const { data: depts, error: deptErr } = await supabase.from('departments').select('id').eq('state_code', stateCode)
  if (deptErr) throw deptErr
  if (depts.length === 0) return []
  const { data, error } = await supabase
    .from('employees').select('*').in('department_id', depts.map((d) => d.id)).eq('status', 'active')
    .order('name', { ascending: true })
  if (error) throw error
  return toEmployees(data)
}

export async function listAllEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*').eq('status', 'active').order('name', { ascending: true })
  if (error) throw error
  return toEmployees(data)
}

export async function listEmployeeDepartments(): Promise<Record<string, { id: string; name: string }>> {
  const { data: employees, error: empErr } = await supabase.from('employees').select('id, department_id').eq('status', 'active')
  if (empErr) throw empErr
  const { data: depts, error: deptErr } = await supabase.from('departments').select('id, parent_id, type_key, name')
  if (deptErr) throw deptErr
  const byId = new Map(depts.map((d) => [d.id, d]))
  const deptOf = (nodeId: string | null) => {
    let cur = nodeId ? byId.get(nodeId) : undefined
    while (cur && cur.type_key !== 'department') cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
    return cur
  }
  const out: Record<string, { id: string; name: string }> = {}
  for (const e of employees) {
    const dept = deptOf(e.department_id)
    if (dept) out[e.id] = { id: dept.id, name: dept.name }
  }
  return out
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const { data, error } = await supabase.from('employees').select('*').eq('id', id).limit(1)
  if (error) throw error
  if (!data[0]) return null
  const [employee] = await toEmployees([data[0]])
  return employee
}

export async function directReports(employeeId: string): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*').eq('manager_id', employeeId).eq('status', 'active')
  if (error) throw error
  return toEmployees(data) // No sort — faithful port; the in-memory version applies none either.
}

export async function reportingChain(employeeId: string): Promise<Employee[]> {
  const chain: Employee[] = []
  const { data: startRows, error: startErr } = await supabase.from('employees').select('manager_id').eq('id', employeeId).limit(1)
  if (startErr) throw startErr
  let managerId: string | null = startRows[0]?.manager_id ?? null
  // No cycle guard — faithful port; the in-memory version has none either.
  while (managerId) {
    const res: { data: EmployeeRow[] | null; error: { message: string } | null } =
      await supabase.from('employees').select('*').eq('id', managerId).limit(1)
    if (res.error) throw res.error
    const mgr: EmployeeRow | undefined = res.data?.[0]
    if (!mgr) break
    const [mapped] = await toEmployees([mgr])
    chain.unshift(mapped)
    managerId = mgr.manager_id
  }
  return chain
}

export async function listTimeline(employeeId: string): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from('timeline_events').select('*').eq('employee_id', employeeId)
    .order('event_date', { ascending: false }).order('id', { ascending: false })
  if (error) throw error
  return data.map(toTimelineEvent)
}

export async function listAllTimelineEvents(filter?: { types?: TimelineEventType[] }): Promise<TimelineEvent[]> {
  let query = supabase.from('timeline_events').select('*')
  if (filter?.types && filter.types.length > 0) query = query.in('type', filter.types)
  const { data, error } = await query.order('event_date', { ascending: false }).order('id', { ascending: false })
  if (error) throw error
  return data.map(toTimelineEvent)
}

export async function listTransfers(employeeId: string): Promise<Transfer[]> {
  const { data, error } = await supabase.from('transfers').select('*').eq('employee_id', employeeId).order('effective_date', { ascending: false })
  if (error) throw error
  return data.map(toTransfer)
}

/** Every transfer across every employee — powers `crossCutting`'s
 *  `relationshipAnalytics` total and its `search`'s "transferred" intent
 *  filter, mirroring the in-memory `this.data.transfers` array. */
export async function listAllTransfers(): Promise<Transfer[]> {
  const { data, error } = await supabase.from('transfers').select('*')
  if (error) throw error
  return data.map(toTransfer)
}

export async function listMergeAudit(): Promise<MergeAuditRecord[]> {
  const { data, error } = await supabase.from('merge_audit_records').select('*').order('merged_at', { ascending: false })
  if (error) throw error
  return data.map(toMergeAuditRecord)
}

export async function createEmployee(input: CreateEmployeeInput): Promise<Employee> {
  const vacant = input.vacant ?? false
  const row = {
    code: `EMP-NEW-${Math.floor(Math.random() * 9000 + 1000)}`, name: input.name, designation: input.designation,
    email: input.email, phone: input.phone, company: input.company ?? '', address: input.address ?? '',
    website: input.website ?? '', photo_url: input.photoUrl ?? null, department_id: input.orgNodeId, manager_id: input.managerId,
    vacant, connected: vacant ? false : input.connected ?? true,
    relationship_status: input.relationshipStatus ?? 'new', relationship_quality: input.relationshipQuality ?? 'neutral',
    relationship_type: input.relationshipType ?? '', introduced_by: input.introducedBy ?? '',
    important_contact: input.importantContact ?? false, preferred_comm: input.preferredComm ?? [],
    last_interaction_at: input.lastInteractionAt ?? null, follow_up_date: input.followUpDate ?? null,
    notes: input.notes ?? '', metadata: input.metadata ?? {}, status: 'active',
  }
  const { data, error } = await supabase.from('employees').insert(row).select('*').single()
  if (error) throw error

  if (input.charges?.length) {
    const chargeRows = input.charges.map((c) => ({ employee_id: data.id, kind: c.kind, title: c.title, department_id: c.orgNodeId, start_date: c.startDate, end_date: c.endDate, reason: c.reason }))
    const { error: chargeErr } = await supabase.from('charges').insert(chargeRows)
    if (chargeErr) throw chargeErr
  }
  if (!vacant) {
    const { error: evtErr } = await supabase.from('timeline_events').insert({
      employee_id: data.id, type: 'joined', title: 'Contact created', event_date: isoToday(), note: '', source: 'system',
    })
    if (evtErr) throw evtErr
  }
  const [employee] = await toEmployees([data])
  return employee
}

const PATCHABLE_FIELDS: [keyof Employee, string][] = [
  ['name', 'name'], ['code', 'code'], ['designation', 'designation'], ['email', 'email'], ['phone', 'phone'],
  ['company', 'company'], ['address', 'address'], ['website', 'website'], ['photoUrl', 'photo_url'],
  ['orgNodeId', 'department_id'], ['managerId', 'manager_id'], ['vacant', 'vacant'], ['connected', 'connected'],
  ['relationshipStatus', 'relationship_status'], ['relationshipQuality', 'relationship_quality'],
  ['relationshipType', 'relationship_type'], ['introducedBy', 'introduced_by'], ['importantContact', 'important_contact'],
  ['preferredComm', 'preferred_comm'], ['lastInteractionAt', 'last_interaction_at'], ['followUpDate', 'follow_up_date'],
  ['notes', 'notes'], ['metadata', 'metadata'], ['status', 'status'],
]

/** Fields with real business/compliance meaning worth a shared audit trail
 *  entry (spec §4/§8 Phase 5) — new instrumentation, not a preserved
 *  behavior: no prior audit trail existed for employees before this. Mirrors
 *  `commercial-skus.ts`'s `SKU_SENSITIVE_FIELDS` pattern. `transferEmployee`'s
 *  own `transfers` table write is a separate, pre-existing audit trail and is
 *  not folded into this list. */
const EMPLOYEE_AUDITED_FIELDS: (keyof Employee)[] = [
  'designation', 'relationshipStatus', 'relationshipQuality', 'importantContact', 'connected',
]

export async function updateEmployee(id: string, patch: Partial<Employee>): Promise<Employee> {
  const existing = await getEmployee(id)
  const update: Record<string, unknown> = {}
  for (const [tsField, dbColumn] of PATCHABLE_FIELDS) {
    if (patch[tsField] !== undefined) update[dbColumn] = patch[tsField]
  }
  // charges/visitingCards are not patchable via this path — addCharge/removeCharge own that table.
  // `update` is dynamically assembled from PATCHABLE_FIELDS, so its precise
  // shape can't be known statically — same escape as hierarchy.ts's fromTable.
  const { data, error } = await supabase.from('employees').update(update as never).eq('id', id).select('*').single()
  if (error) throw error // .single() errors if id doesn't exist — matches the in-memory non-null-assertion's throw.
  const [employee] = await toEmployees([data])

  if (existing) {
    for (const field of EMPLOYEE_AUDITED_FIELDS) {
      if (patch[field] !== undefined && patch[field] !== existing[field]) {
        await recordAuditLogEntry({
          entityType: 'employee', entityId: id, field,
          oldValue: String(existing[field]), newValue: String(patch[field]),
          reason: '', action: 'update', changedBy: null,
        })
      }
    }
  }
  return employee
}

export async function setManager(employeeId: string, managerId: string | null): Promise<void> {
  if (employeeId === managerId) throw new Error('An employee cannot report to themselves')
  const seen = new Set<string>()
  let currentId: string | null = managerId
  while (currentId) {
    if (currentId === employeeId) throw new Error('That would create a reporting cycle')
    if (seen.has(currentId)) break
    seen.add(currentId)
    const res: { data: { manager_id: string | null }[] | null; error: { message: string } | null } =
      await supabase.from('employees').select('manager_id').eq('id', currentId).limit(1)
    if (res.error) throw res.error
    currentId = res.data?.[0]?.manager_id ?? null
  }
  const { error: updateErr } = await supabase.from('employees').update({ manager_id: managerId }).eq('id', employeeId)
  if (updateErr) throw updateErr
}

export async function deleteEmployee(id: string): Promise<void> {
  // Faithful port of a pre-existing bug (Global Constraints item 1): direct
  // reports always end up with no manager, never inherit the deleted
  // employee's manager. Flagged, not fixed, in Step 8 below.
  const { error: reportsErr } = await supabase.from('employees').update({ manager_id: null }).eq('manager_id', id)
  if (reportsErr) throw reportsErr
  const { error: followUpErr } = await supabase.from('follow_ups').delete().eq('entity_type', 'contact').eq('entity_id', id)
  if (followUpErr) throw followUpErr
  // charges/visiting_cards/timeline_events/transfers cascade via their own employee_id FK (Phase 1).
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) throw error
}

export async function mergeEmployees(input: MergeEmployeesInput): Promise<{ survivor: Employee; audit: MergeAuditRecord }> {
  const { error } = await supabase.rpc('merge_employees', {
    p_survivor_id: input.survivorId, p_duplicate_id: input.duplicateId, p_resolutions: input.resolutions,
  })
  if (error) throw error
  const survivor = await getEmployee(input.survivorId)
  const [audit] = await listMergeAudit()
  return { survivor: survivor!, audit }
}

export async function addTimelineEvent(input: AddTimelineInput): Promise<TimelineEvent> {
  const row = {
    employee_id: input.employeeId, type: input.type, title: input.title,
    custom_label: input.type === 'custom' ? (input.customLabel?.trim() || null) : null,
    event_date: input.date, event_time: input.time || null,
    note: input.note ?? '', source: 'manual',
    // `timeline_events.attendees` is NOT NULL default '{}' — unlike the
    // in-memory version, which stores `undefined` outright, an omitted
    // attendee list here round-trips as `[]`. toTimelineEvent's `?? undefined`
    // only guards against a genuinely null column, not this empty-array case.
    attendees: input.attendees ?? [],
  }
  const { data, error } = await supabase.from('timeline_events').insert(row).select('*').single()
  if (error) throw error
  return toTimelineEvent(data)
}

export async function setTimelineEventAttended(id: string, attended: boolean | undefined): Promise<void> {
  const { error } = await supabase.from('timeline_events').update({ attended: attended ?? null }).eq('id', id)
  if (error) throw error
}

export async function deleteTimelineEvent(id: string): Promise<void> {
  const { error } = await supabase.from('timeline_events').delete().eq('id', id)
  if (error) throw error
}

export async function transferEmployee(input: TransferInput): Promise<Transfer> {
  const { data: empRows, error: empErr } = await supabase.from('employees').select('*').eq('id', input.employeeId).limit(1)
  if (empErr) throw empErr
  const emp = empRows[0]
  if (!emp) throw new Error(`No such employee: ${input.employeeId}`)

  const { data: depts, error: deptErr } = await supabase.from('departments').select('id, parent_id, type_key, name')
  if (deptErr) throw deptErr
  const byId = new Map(depts.map((d) => [d.id, d]))
  const deptOf = (nodeId: string | null) => {
    let cur = nodeId ? byId.get(nodeId) : undefined
    while (cur && cur.type_key !== 'department') cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
    return cur
  }
  const managerName = async (mid: string | null) => {
    if (!mid) return '—'
    const { data } = await supabase.from('employees').select('name').eq('id', mid).limit(1)
    return data?.[0]?.name ?? '—'
  }

  const managerChanging = input.toManagerId !== undefined
  const fromManagerName = await managerName(emp.manager_id)
  const toManagerName = managerChanging ? await managerName(input.toManagerId ?? null) : fromManagerName

  const transferRow = {
    employee_id: emp.id, from_designation: emp.designation, to_designation: input.toDesignation || emp.designation,
    from_department_name: deptOf(emp.department_id)?.name ?? '—', to_department_name: deptOf(input.toOrgNodeId)?.name ?? '—',
    from_office_name: byId.get(emp.department_id ?? '')?.name ?? '—', to_office_name: byId.get(input.toOrgNodeId)?.name ?? '—',
    to_org_node_id: input.toOrgNodeId, from_manager_name: fromManagerName, to_manager_name: toManagerName,
    effective_date: input.effectiveDate, reason: input.reason, remarks: input.remarks ?? '',
  }
  const { data: transfer, error: trErr } = await supabase.from('transfers').insert(transferRow).select('*').single()
  if (trErr) throw trErr

  const empUpdate: Record<string, unknown> = { department_id: input.toOrgNodeId }
  if (input.toDesignation) empUpdate.designation = input.toDesignation
  if (managerChanging) empUpdate.manager_id = input.toManagerId ?? null
  const { error: updErr } = await supabase.from('employees').update(empUpdate as never).eq('id', emp.id)
  if (updErr) throw updErr

  const { error: evtErr } = await supabase.from('timeline_events').insert({
    employee_id: emp.id, type: 'transferred', title: `Transferred to ${transfer.to_office_name}`,
    event_date: input.effectiveDate, note: input.reason, source: 'system',
  })
  if (evtErr) throw evtErr
  return toTransfer(transfer)
}

export async function addCharge(employeeId: string, charge: Omit<Charge, 'id'>): Promise<Charge> {
  const row = { employee_id: employeeId, kind: charge.kind, title: charge.title, department_id: charge.orgNodeId, start_date: charge.startDate, end_date: charge.endDate, reason: charge.reason }
  const { data, error } = await supabase.from('charges').insert(row).select('*').single()
  if (error) throw error
  const { error: evtErr } = await supabase.from('timeline_events').insert({
    employee_id: employeeId, type: charge.kind === 'acting' ? 'promoted' : 'custom',
    title: `${charge.kind === 'acting' ? 'Acting' : 'Additional'} charge: ${charge.title}`,
    event_date: charge.startDate ?? isoToday(), note: charge.reason, source: 'system',
  })
  if (evtErr) throw evtErr
  return toCharge(data)
}

export async function removeCharge(employeeId: string, chargeId: string): Promise<void> {
  const { error } = await supabase.from('charges').delete().eq('id', chargeId).eq('employee_id', employeeId)
  if (error) throw error
}

export async function importEmployees(orgNodeId: string, rows: ImportEmployeeRow[]): Promise<number> {
  const { data: deptRows, error } = await supabase.from('departments').select('id').eq('id', orgNodeId).limit(1)
  if (error) throw error
  if (!deptRows[0]) return 0
  let added = 0
  for (const row of rows) {
    const name = row.name.trim()
    const designation = row.designation.trim()
    if (!name || !designation) continue
    await createEmployee({ name, designation, email: row.email?.trim() ?? '', phone: row.phone?.trim() ?? '', orgNodeId, managerId: null, connected: row.connected })
    added += 1
  }
  return added
}

import { isoToday } from '@/lib/dates'
import type { SalesPerson, SalesPosting } from '@/lib/types'
import { tierRank } from '../sales-tiers'
import type { CreateSalesPersonInput, TransferSalesPersonInput } from '../in-memory/repository'
import { supabase } from './client'
import type { Database } from './database.types'

type SalesPersonRow = Database['public']['Tables']['sales_people']['Row']
type SalesPostingRow = Database['public']['Tables']['sales_postings']['Row']

function toSalesPerson(row: SalesPersonRow): SalesPerson {
  return {
    id: row.id, employeeCode: row.employee_code, name: row.name, officialEmail: row.official_email,
    personalEmail: row.personal_email, mobile: row.mobile, altMobile: row.alt_mobile,
    joinedOn: row.joined_on, leftOn: row.left_on, status: row.status as SalesPerson['status'],
    notes: row.notes, metadata: (row.metadata ?? {}) as Record<string, string>,
    createdAt: row.created_at, createdBy: row.created_by,
  }
}

function toSalesPosting(row: SalesPostingRow): SalesPosting {
  return {
    id: row.id, salesPersonId: row.sales_person_id, designation: row.designation, tierKey: row.tier_key,
    managerId: row.manager_id, office: row.office,
    // SalesPosting.startDate is non-nullable string ('' = unknown, per
    // sales-roster-seed.ts) but the column is a nullable `date` (schema
    // comment on sales_postings.start_date) — convert null back to ''
    // rather than leak null into a field the rest of the app treats as
    // always-a-string.
    startDate: row.start_date ?? '',
    endDate: row.end_date,
    changeType: row.change_type as SalesPosting['changeType'], reason: row.reason,
    createdAt: row.created_at, createdBy: row.created_by,
  }
}

export async function createSalesPerson(input: CreateSalesPersonInput): Promise<SalesPerson> {
  const row = {
    employee_code: '', name: input.name, official_email: input.officialEmail,
    personal_email: input.personalEmail ?? '', mobile: input.mobile ?? '', alt_mobile: input.altMobile ?? '',
    status: 'active', notes: input.notes ?? '',
  }
  const { data, error } = await supabase.from('sales_people').insert(row).select('*').single()
  if (error) throw error

  const { error: postingErr } = await supabase.from('sales_postings').insert({
    sales_person_id: data.id, designation: input.designation, tier_key: input.tierKey,
    manager_id: input.managerId ?? null, office: '', start_date: isoToday(), end_date: null,
    change_type: 'initial', reason: '',
  })
  if (postingErr) throw postingErr
  return toSalesPerson(data)
}

const SP_PATCHABLE: [keyof SalesPerson, string][] = [
  ['employeeCode', 'employee_code'], ['name', 'name'], ['officialEmail', 'official_email'], ['personalEmail', 'personal_email'],
  ['mobile', 'mobile'], ['altMobile', 'alt_mobile'], ['joinedOn', 'joined_on'], ['leftOn', 'left_on'],
  ['status', 'status'], ['notes', 'notes'], ['metadata', 'metadata'],
]

export async function updateSalesPerson(id: string, patch: Partial<SalesPerson>): Promise<SalesPerson> {
  const update: Record<string, unknown> = {}
  for (const [tsField, dbColumn] of SP_PATCHABLE) if (patch[tsField] !== undefined) update[dbColumn] = patch[tsField]
  const { data, error } = await supabase.from('sales_people').update(update as never).eq('id', id).select('*')
  if (error) throw error
  if (data.length === 0) throw new Error(`No such salesperson: ${id}`) // matches the in-memory explicit throw message
  return toSalesPerson(data[0])
}

export async function setSalesPersonStatus(id: string, status: SalesPerson['status']): Promise<void> {
  const { error } = await supabase.from('sales_people').update({ status }).eq('id', id)
  if (error) throw error // 0 matching rows is a silent no-op, not an error — matches the in-memory version.
}

export async function deleteSalesPerson(id: string): Promise<void> {
  const { error } = await supabase.from('sales_people').delete().eq('id', id)
  if (error) throw error
}

export async function transferSalesPerson(input: TransferSalesPersonInput): Promise<SalesPosting> {
  const { data: personRows, error: personErr } = await supabase.from('sales_people').select('id').eq('id', input.salesPersonId).limit(1)
  if (personErr) throw personErr
  if (!personRows[0]) throw new Error(`No such salesperson: ${input.salesPersonId}`)

  const { data: currentRows, error: curErr } = await supabase
    .from('sales_postings').select('*').eq('sales_person_id', input.salesPersonId).is('end_date', null).limit(1)
  if (curErr) throw curErr
  const current = currentRows[0]

  if (current) {
    if (current.start_date && input.effectiveDate <= current.start_date) {
      throw new Error(`The current posting starts on ${current.start_date}; a transfer must take effect after that.`)
    }
    const { error: closeErr } = await supabase.from('sales_postings').update({ end_date: input.effectiveDate }).eq('id', current.id)
    if (closeErr) throw closeErr
  }

  const oldRank = current ? tierRank(current.tier_key) : null
  const newRank = tierRank(input.tierKey)
  const changeType = oldRank === null ? 'initial' : newRank < oldRank ? 'promotion' : newRank > oldRank ? 'demotion' : 'lateralMove'

  const { data: posting, error } = await supabase.from('sales_postings').insert({
    sales_person_id: input.salesPersonId, designation: input.designation, tier_key: input.tierKey,
    manager_id: input.managerId ?? null, office: input.office ?? '', start_date: input.effectiveDate,
    end_date: null, change_type: changeType, reason: input.reason ?? '',
  }).select('*').single()
  if (error) throw error
  return toSalesPosting(posting)
}

export async function listSalesPersons(): Promise<SalesPerson[]> {
  const { data, error } = await supabase.from('sales_people').select('*').order('name', { ascending: true })
  if (error) throw error
  return data.map(toSalesPerson)
}

export async function getSalesPerson(id: string): Promise<SalesPerson | null> {
  const { data, error } = await supabase.from('sales_people').select('*').eq('id', id).limit(1)
  if (error) throw error
  return data[0] ? toSalesPerson(data[0]) : null
}

export async function listSalesPostings(salesPersonId: string): Promise<SalesPosting[]> {
  const { data, error } = await supabase
    .from('sales_postings').select('*').eq('sales_person_id', salesPersonId).order('start_date', { ascending: false })
  if (error) throw error
  return data.map(toSalesPosting)
}

export async function currentPostings(): Promise<Record<string, SalesPosting>> {
  const { data, error } = await supabase.from('sales_postings').select('*').is('end_date', null)
  if (error) throw error
  const out: Record<string, SalesPosting> = {}
  for (const row of data) out[row.sales_person_id] = toSalesPosting(row)
  return out
}

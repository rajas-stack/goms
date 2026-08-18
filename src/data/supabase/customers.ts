import type { Customer } from '@/lib/types'
import type { CreateCustomerInput } from '../in-memory/repository'
import { supabase } from './client'
import type { Database } from './database.types'

type CustomerRow = Database['public']['Tables']['customers']['Row']

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id, name: row.name, organization: row.organization, address: row.address, gst: row.gst,
    contactName: row.contact_name, contactEmail: row.contact_email, contactPhone: row.contact_phone,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from('customers').select('*').order('name', { ascending: true })
  if (error) throw error
  return data.map(toCustomer)
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase.from('customers').select('*').eq('id', id).limit(1)
  if (error) throw error
  return data[0] ? toCustomer(data[0]) : null
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const row = {
    name: input.name, organization: input.organization ?? '', address: input.address ?? '', gst: input.gst ?? '',
    contact_name: input.contactName ?? '', contact_email: input.contactEmail ?? '', contact_phone: input.contactPhone ?? '',
    notes: input.notes ?? '',
  }
  const { data, error } = await supabase.from('customers').insert(row).select('*').single()
  if (error) throw error
  return toCustomer(data)
}

const PATCHABLE_FIELDS: [keyof Customer, string][] = [
  ['name', 'name'], ['organization', 'organization'], ['address', 'address'], ['gst', 'gst'],
  ['contactName', 'contact_name'], ['contactEmail', 'contact_email'], ['contactPhone', 'contact_phone'], ['notes', 'notes'],
]

export async function updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const [tsField, dbColumn] of PATCHABLE_FIELDS) {
    if (patch[tsField] !== undefined) update[dbColumn] = patch[tsField]
  }
  const { data, error } = await supabase.from('customers').update(update as never).eq('id', id).select('*').single()
  if (error) throw error
  return toCustomer(data)
}

export async function deleteCustomer(id: string): Promise<void> {
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) throw error
}

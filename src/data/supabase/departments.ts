import type { HierNode, Status } from '@/lib/types'
import { supabase } from './client'
import type { Database } from './database.types'

type DepartmentRow = Database['public']['Tables']['departments']['Row']

function toHierNode(row: DepartmentRow): HierNode {
  return {
    id: row.id,
    domain: 'org',
    typeKey: row.type_key,
    parentId: row.parent_id,
    stateCode: row.state_code,
    name: row.name,
    code: row.code,
    sortOrder: row.sort_order,
    metadata: (row.metadata ?? {}) as Record<string, string>,
    status: row.status as Status,
  }
}

/** Every org type key — ported verbatim from the in-memory `POSTING_TYPES`
 *  set (in-memory/repository.ts). Despite `listPostingNodes`'s doc comment
 *  saying "(offices/units)", the actual set includes every level; this is a
 *  faithful port of the real behavior, not the stale comment. */
const POSTING_TYPES = ['department', 'branch', 'division', 'office', 'unit']

export async function listOrgRoots(stateCode: number): Promise<HierNode[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('type_key', 'department')
    .eq('state_code', stateCode)
    .eq('status', 'active')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data.map(toHierNode)
}

export async function listDepartments(): Promise<HierNode[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('type_key', 'department')
    .eq('status', 'active')
    .order('state_code', { ascending: true, nullsFirst: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data.map(toHierNode)
}

export async function listPostingNodes(stateCode: number): Promise<HierNode[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .in('type_key', POSTING_TYPES)
    .eq('state_code', stateCode)
    .eq('status', 'active')
    .order('name', { ascending: true })
  if (error) throw error
  return data.map(toHierNode)
}

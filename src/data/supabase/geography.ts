import type { HierNode, Status } from '@/lib/types'
import type { StateSummary } from '../in-memory/repository'
import { supabase } from './client'
import type { Database } from './database.types'

type GeoNodeRow = Database['public']['Tables']['geo_nodes']['Row']

function toHierNode(row: GeoNodeRow): HierNode {
  return {
    id: row.id,
    domain: 'geo',
    typeKey: row.type_key,
    parentId: row.parent_id,
    stateCode: row.state_code,
    name: row.name,
    code: row.code,
    sortOrder: row.sort_order,
    // geo_nodes has no metadata column — no geo node has ever carried
    // metadata in the in-memory store either (only org nodes populate it).
    metadata: {},
    status: row.status as Status,
  }
}

export async function getState(code: number): Promise<HierNode | undefined> {
  const { data, error } = await supabase
    .from('geo_nodes').select('*').eq('type_key', 'state').eq('state_code', code).limit(1)
  if (error) throw error
  return data[0] ? toHierNode(data[0]) : undefined
}

export async function geoRoot(): Promise<HierNode | undefined> {
  const { data, error } = await supabase.from('geo_nodes').select('*').eq('type_key', 'country').limit(1)
  if (error) throw error
  return data[0] ? toHierNode(data[0]) : undefined
}

/** Classified under `geography` in DOMAIN_OF (not the domain-agnostic
 *  `hierarchy` bucket the in-memory version's shared `activeChildren` helper
 *  would suggest) — this Supabase-backed version deliberately only queries
 *  `geo_nodes`, matching the domain split the schema already enforces. Its
 *  only real caller is the geography explorer's districts-per-state count. */
export async function childCounts(parentId: string): Promise<Record<string, number>> {
  const { data: children, error: childError } = await supabase
    .from('geo_nodes').select('id').eq('parent_id', parentId).eq('status', 'active')
  if (childError) throw childError
  if (children.length === 0) return {}

  const childIds = children.map((c) => c.id)
  const { data: grandchildren, error: gcError } = await supabase
    .from('geo_nodes').select('parent_id').in('parent_id', childIds).eq('status', 'active')
  if (gcError) throw gcError

  const out: Record<string, number> = {}
  for (const id of childIds) out[id] = 0
  for (const row of grandchildren) out[row.parent_id!] += 1
  return out
}

export async function listStates(): Promise<StateSummary[]> {
  const { data: states, error: statesError } = await supabase.from('geo_nodes').select('*').eq('type_key', 'state')
  if (statesError) throw statesError

  // No status filter on org rows — preserves the in-memory listStates's
  // existing inconsistency with listDepartments/listOrgRoots (Global
  // Constraints, item 3). Fetches every department row's id/type/state so
  // departments-per-state, offices-per-state, and the org-node-id set (for
  // the employee count below) can all be derived from one query.
  const { data: orgRows, error: orgError } = await supabase.from('departments').select('id, type_key, state_code')
  if (orgError) throw orgError

  const { data: employeeRows, error: empError } = await supabase
    .from('employees').select('department_id').eq('status', 'active').eq('vacant', false)
  if (empError) throw empError

  return states
    .map((s) => {
      const code = s.state_code!
      const orgUnder = orgRows.filter((r) => r.state_code === code)
      const orgIds = new Set(orgUnder.map((r) => r.id))
      return {
        code,
        name: s.name,
        departments: orgUnder.filter((r) => r.type_key === 'department').length,
        offices: orgUnder.filter((r) => r.type_key === 'office').length,
        employees: employeeRows.filter((e) => e.department_id && orgIds.has(e.department_id)).length,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

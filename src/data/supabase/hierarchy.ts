import { uid } from '@/lib/utils'
import { childTypesOf, NODE_TYPE_MAP } from '@/lib/node-types'
import type { Domain, HierNode, Status } from '@/lib/types'
import type { CreateNodeInput, ImportChildRow } from '../in-memory/repository'
import { supabase } from './client'

type NodeTable = 'departments' | 'geo_nodes'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any

function tableForId(id: string): NodeTable {
  if (id.startsWith('org_')) return 'departments'
  if (id.startsWith('geo_')) return 'geo_nodes'
  throw new Error(`Cannot determine table for node id: ${id}`)
}

function tableForDomain(domain: Domain): NodeTable {
  if (domain === 'org') return 'departments'
  if (domain === 'geo') return 'geo_nodes'
  throw new Error(`Domain '${domain}' has no Supabase-backed node table yet`)
}

/** `table` is picked at runtime (id-prefix/domain dispatch — see module doc),
 *  so its static type is the union `NodeTable`. Supabase's generated
 *  `.from()` overloads resolve per-literal-table, not per-union, which makes
 *  every insert/update/eq call below reject a union-typed table with a
 *  generated-row-shape mismatch even though the row is always valid at
 *  runtime (this file already treats rows as `AnyRow` for the same reason).
 *  Centralizing the cast here keeps it to one spot instead of one per call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromTable(table: NodeTable): any {
  return supabase.from(table)
}

function rowToHierNode(table: NodeTable, row: AnyRow): HierNode {
  return {
    id: row.id,
    domain: table === 'departments' ? 'org' : 'geo',
    typeKey: row.type_key,
    parentId: row.parent_id,
    stateCode: row.state_code,
    name: row.name,
    code: row.code,
    sortOrder: row.sort_order,
    metadata: table === 'departments' ? ((row.metadata ?? {}) as Record<string, string>) : {},
    status: row.status as Status,
  }
}

async function subtreeIds(table: NodeTable, id: string): Promise<string[]> {
  const fn = table === 'departments' ? 'department_subtree_ids' : 'geo_node_subtree_ids'
  const { data, error } = await supabase.rpc(fn, { p_id: id })
  if (error) throw error
  return data as unknown as string[]
}

export async function getNode(id: string): Promise<HierNode | undefined> {
  const table = tableForId(id)
  const { data, error } = await fromTable(table).select('*').eq('id', id).limit(1)
  if (error) throw error
  return data[0] ? rowToHierNode(table, data[0]) : undefined
}

export async function listChildren(parentId: string): Promise<HierNode[]> {
  const table = tableForId(parentId)
  const { data, error } = await fromTable(table).select('*').eq('parent_id', parentId).eq('status', 'active')
    .order('sort_order', { ascending: true }).order('name', { ascending: true })
  if (error) throw error
  return data.map((r: AnyRow) => rowToHierNode(table, r))
}

export async function breadcrumb(id: string): Promise<HierNode[]> {
  const table = tableForId(id)
  const chain: HierNode[] = []
  let currentId: string | null = id
  while (currentId) {
    const res: { data: AnyRow[] | null; error: { message: string } | null } =
      await fromTable(table).select('*').eq('id', currentId).limit(1)
    if (res.error) throw res.error
    const row: AnyRow | undefined = res.data?.[0]
    if (!row) break
    chain.unshift(rowToHierNode(table, row))
    currentId = row.parent_id as string | null
  }
  return chain
}

export async function childCount(id: string): Promise<number> {
  const table = tableForId(id)
  const { count, error } = await fromTable(table).select('*', { count: 'exact', head: true }).eq('parent_id', id).eq('status', 'active')
  if (error) throw error
  return count ?? 0
}

export async function createNode(input: CreateNodeInput): Promise<HierNode> {
  const table = tableForDomain(input.domain)

  if (input.typeKey === 'branch' && input.parentId) {
    const { data: siblings, error: sibErr } = await fromTable(table).select('*').eq('parent_id', input.parentId).eq('status', 'active')
    if (sibErr) throw sibErr
    const dup = siblings.find(
      (c: AnyRow) => c.type_key === 'branch' && c.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
    )
    if (dup) return rowToHierNode(table, dup)
  }

  let sortOrder = 0
  if (input.parentId) {
    const { count, error: countErr } = await fromTable(table).select('*', { count: 'exact', head: true }).eq('parent_id', input.parentId).eq('status', 'active')
    if (countErr) throw countErr
    sortOrder = count ?? 0
  }

  const row: Record<string, unknown> = {
    id: uid(input.domain), parent_id: input.parentId, state_code: input.stateCode, type_key: input.typeKey,
    name: input.name, code: null, sort_order: sortOrder, status: 'active',
  }
  if (table === 'departments') row.metadata = input.metadata ?? {}

  const { data, error } = await fromTable(table).insert(row).select('*').single()
  if (error) throw error
  return rowToHierNode(table, data)
}

export async function updateNode(id: string, patch: Partial<Pick<HierNode, 'name' | 'metadata'>>): Promise<HierNode> {
  const table = tableForId(id)
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.metadata !== undefined && table === 'departments') update.metadata = patch.metadata
  const { data, error } = await fromTable(table).update(update).eq('id', id).select('*').single()
  if (error) throw error // .single() errors (PGRST116) if id doesn't exist — matches the in-memory non-null-assertion's "throws" behavior.
  return rowToHierNode(table, data)
}

export async function setNodeStatus(id: string, status: Status): Promise<void> {
  const table = tableForId(id)
  const ids = await subtreeIds(table, id)
  const { error } = await fromTable(table).update({ status }).in('id', ids)
  if (error) throw error
}

export async function deleteNode(id: string): Promise<void> {
  const table = tableForId(id)
  const ids = await subtreeIds(table, id)
  const { error } = await fromTable(table).delete().in('id', ids)
  if (error) throw error
}

export async function moveNode(id: string, newParentId: string | null): Promise<void> {
  const table = tableForId(id)
  if (newParentId) {
    const ids = await subtreeIds(table, id)
    if (ids.includes(newParentId)) throw new Error('Cannot move a node into its own subtree')
  }
  const { error } = await fromTable(table).update({ parent_id: newParentId }).eq('id', id)
  if (error) throw error
}

export async function duplicateNode(id: string): Promise<HierNode> {
  const table = tableForId(id)
  const ids = await subtreeIds(table, id)
  const { data: rows, error } = await fromTable(table).select('*').in('id', ids)
  if (error) throw error
  const original = rows.find((r: AnyRow) => r.id === id)!

  const idMap = new Map<string, string>()
  for (const row of rows) idMap.set(row.id, uid(table === 'departments' ? 'org' : 'geo'))

  const clones = rows.map((row: AnyRow) => {
    const isRoot = row.id === id
    const base: Record<string, unknown> = {
      id: idMap.get(row.id),
      parent_id: isRoot ? original.parent_id : (idMap.get(row.parent_id) ?? row.parent_id),
      type_key: row.type_key, state_code: row.state_code,
      name: isRoot ? `${original.name} (Copy)` : row.name,
      code: row.code, sort_order: row.sort_order, status: row.status,
    }
    if (table === 'departments') base.metadata = row.metadata ?? {}
    return base
  })

  const { data: inserted, error: insertError } = await fromTable(table).insert(clones).select('*')
  if (insertError) throw insertError
  const rootClone = inserted.find((r: AnyRow) => r.id === idMap.get(id))!
  return rowToHierNode(table, rootClone)
}

export async function reorderNode(id: string, beforeId: string | null): Promise<void> {
  const table = tableForId(id)
  const { data: nodeRows, error: nodeErr } = await fromTable(table).select('*').eq('id', id).limit(1)
  if (nodeErr) throw nodeErr
  const node = nodeRows[0]
  if (!node) return

  const { data: siblings, error: sibErr } = await fromTable(table).select('*').eq('parent_id', node.parent_id).eq('status', 'active')
    .order('sort_order', { ascending: true }).order('name', { ascending: true })
  if (sibErr) throw sibErr

  const ordered = siblings.filter((n: AnyRow) => n.id !== id)
  const idx = beforeId ? ordered.findIndex((n: AnyRow) => n.id === beforeId) : -1
  if (idx >= 0) ordered.splice(idx, 0, node)
  else ordered.push(node)

  await Promise.all(ordered.map((n: AnyRow, i: number) => fromTable(table).update({ sort_order: i }).eq('id', n.id)))
}

export async function importChildren(parentId: string, rows: ImportChildRow[]): Promise<number> {
  const table = tableForId(parentId)
  const { data: parentRows, error } = await fromTable(table).select('*').eq('id', parentId).limit(1)
  if (error) throw error
  const parent = parentRows[0]
  if (!parent) return 0

  const validTypes = childTypesOf(parent.type_key)
  const defaultType = NODE_TYPE_MAP[parent.type_key]?.childKeys[0] ?? 'district'
  let added = 0
  for (const row of rows) {
    const trimmed = row.name.trim()
    if (!trimmed) continue
    const matched = row.type
      ? validTypes.find((t) => t.label.toLowerCase() === row.type!.trim().toLowerCase())
      : undefined
    await createNode({
      domain: table === 'departments' ? 'org' : 'geo',
      typeKey: matched?.key ?? defaultType, parentId, stateCode: parent.state_code, name: trimmed,
    })
    added += 1
  }
  return added
}

export async function moveTargets(nodeId: string): Promise<HierNode[]> {
  const table = tableForId(nodeId)
  const { data: nodeRows, error } = await fromTable(table).select('*').eq('id', nodeId).limit(1)
  if (error) throw error
  const node = nodeRows[0]
  if (!node) return []

  const banned = new Set(await subtreeIds(table, nodeId))
  const { data: candidates, error: candErr } = await fromTable(table).select('*').eq('state_code', node.state_code).eq('status', 'active')
  if (candErr) throw candErr

  return candidates
    .filter((c: AnyRow) => !banned.has(c.id))
    .filter((c: AnyRow) => {
      const allowed = NODE_TYPE_MAP[c.type_key]?.childKeys ?? []
      return allowed.length === 0 || allowed.includes(node.type_key)
    })
    .map((c: AnyRow) => rowToHierNode(table, c))
}

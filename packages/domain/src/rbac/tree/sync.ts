import type { RbacNode, RbacNodeDef, RbacSyncResult } from './types.js'

const sameDef = (a: RbacNodeDef, b: RbacNodeDef): boolean =>
  a.parentId === b.parentId && a.label === b.label && a.kind === b.kind && a.order === b.order
  && a.actions.join() === b.actions.join() && JSON.stringify(a.dynamic ?? null) === JSON.stringify(b.dynamic ?? null)

/**
 * Brings a stored node list in line with the manifest: new nodes are added (they inherit from their parent because they
 * have no grants), changed ones updated, nodes missing from the manifest are marked retired (never removed), and retired
 * nodes that reappear are restored. Pure: returns a new list.
 */
export function syncNodeList(stored: readonly RbacNode[], manifest: readonly RbacNodeDef[]): { nodes: RbacNode[]; result: RbacSyncResult } {
  const byId = new Map(stored.map((n) => [n.id, n]))
  const declared = new Set(manifest.map((n) => n.id))
  const result: RbacSyncResult = { added: 0, updated: 0, retired: 0, restored: 0 }
  const nodes: RbacNode[] = manifest.map((def) => {
    const old = byId.get(def.id)
    if (!old) result.added++
    else if (old.retired) result.restored++
    else if (!sameDef(old, def)) result.updated++
    return { ...def, actions: [...def.actions], retired: false, runtime: false }
  })
  for (const old of stored) {
    if (declared.has(old.id) || old.runtime) continue
    if (!old.retired) result.retired++
    nodes.push({ ...old, retired: true })
  }
  return { nodes, result }
}

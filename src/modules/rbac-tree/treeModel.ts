import {
  RBAC_ACTIONS, applyGrantChanges, resolveTree,
  type RbacAction, type RbacCellValue, type RbacGrantChange, type RbacGrantMap, type RbacNode, type RbacResolution,
} from '@goms/domain'

export interface TreeRow { node: RbacNode; depth: number; hasChildren: boolean }

/** Children of every node, siblings by declared order then label. A node whose parent is unknown is a root. */
export function childrenIndex(nodes: readonly RbacNode[]): Map<string | null, RbacNode[]> {
  const ids = new Set(nodes.map((n) => n.id))
  const index = new Map<string | null, RbacNode[]>()
  for (const n of nodes) {
    const parent = n.parentId && ids.has(n.parentId) ? n.parentId : null
    index.set(parent, [...(index.get(parent) ?? []), n])
  }
  for (const list of index.values()) list.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  return index
}

export interface VisibleOptions { expanded: ReadonlySet<string>; query: string; showRetired: boolean }

/** The rows to draw. A search shows every match with its ancestors (expanded); otherwise only expanded branches open. */
export function visibleRows(nodes: readonly RbacNode[], { expanded, query, showRetired }: VisibleOptions): TreeRow[] {
  const pool = showRetired ? nodes : nodes.filter((n) => !n.retired)
  const index = childrenIndex(pool)
  const q = query.trim().toLowerCase()
  const keep = new Set<string>()
  if (q) {
    const byId = new Map(pool.map((n) => [n.id, n]))
    for (const n of pool) {
      if (!n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) continue
      for (let cur: RbacNode | undefined = n; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) keep.add(cur.id)
    }
  }
  const out: TreeRow[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const node of index.get(parent) ?? []) {
      if (q && !keep.has(node.id)) continue
      const hasChildren = (index.get(node.id) ?? []).length > 0
      out.push({ node, depth, hasChildren })
      if (hasChildren && (q || expanded.has(node.id))) walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export const allParentIds = (nodes: readonly RbacNode[]): string[] => [...childrenIndex(nodes).keys()].filter((k): k is string => !!k)

/** inherit → allow → deny → inherit. */
export const nextValue = (v: RbacCellValue): RbacCellValue => (v === 'inherit' ? 'allow' : v === 'allow' ? 'deny' : 'inherit')

/** Clears every override below `nodeId` so the whole branch follows this row. */
export function applyToChildren(draft: RbacGrantMap, nodeId: string): RbacGrantMap {
  const prefix = `${nodeId}.`
  const changes: RbacGrantChange[] = []
  for (const id of Object.keys(draft)) {
    if (!id.startsWith(prefix)) continue
    for (const action of RBAC_ACTIONS) if (draft[id]?.[action]) changes.push({ nodeId: id, action, value: 'inherit' })
  }
  return applyGrantChanges(draft, changes)
}

/** How a subject's own draft resolves on its own: its overrides, then its linked template, then parents, then allow. */
export const resolveSubject = (nodes: readonly RbacNode[], own: RbacGrantMap, template: RbacGrantMap | null): RbacResolution =>
  resolveTree(nodes, [{ name: 'own', maps: [own] }, ...(template ? [{ name: 'template', maps: [template] }] : [])])

export const isApplicable = (node: RbacNode, action: RbacAction): boolean => node.actions.includes(action)

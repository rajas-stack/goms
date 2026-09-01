import type { HierNode } from '@/lib/types'

/** Walks `parentId` upward from `orgNode` until it finds a node with
 *  `typeKey === 'department'` — mirroring the existing
 *  `trail.find(t => t.typeKey === 'department')` pattern in
 *  `EmployeeDetails.tsx:97`, but as a standalone function over a flat node
 *  list rather than a breadcrumb trail, so callers without a breadcrumb
 *  (e.g. `EmployeeFormDialog`) can resolve it directly.
 *
 *  `orgNode` itself is included in the walk, so a department passed in
 *  directly resolves to itself. Returns `null` if no department ancestor is
 *  found (shouldn't happen in practice, but callers must handle it — e.g.
 *  falling back to an editable field — rather than assuming a match). */
export function resolveDepartment(orgNode: HierNode, allNodes: HierNode[]): HierNode | null {
  const byId = new Map(allNodes.map((n) => [n.id, n] as const))
  let current: HierNode | undefined = orgNode
  const guard = new Set<string>()
  while (current) {
    if (current.typeKey === 'department') return current
    if (guard.has(current.id)) return null // cyclic parentId chain — never trust it
    guard.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return null
}

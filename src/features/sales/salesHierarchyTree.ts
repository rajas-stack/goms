import type { SalesPerson, SalesPosting } from '@/lib/types'

export interface SalesOrgTree {
  roots: SalesPerson[]
  childrenOf: Map<string, SalesPerson[]>
  /** Root ids forced there only because their `managerId` is broken (points
   *  to nobody in the live roster) or is part of a manager cycle — never a
   *  legitimate "top of the chain" person like an unmanaged Sales Head. The
   *  UI must flag these distinctly rather than rendering them the same way. */
  flaggedRootIds: Set<string>
}

/** Builds the manager -> direct-reports tree strictly from
 *  `SalesPosting.managerId` — never `gm_override_id`, designation, tier, or
 *  name/ordering (a hierarchy must not be invented from those).
 *
 *  A person with no open posting or an unset `managerId` is a legitimate
 *  root. A `managerId` that doesn't resolve to a live person, or that would
 *  require rendering a cycle, is ALSO forced to the root list — never
 *  dropped, never given an invented parent — but marked in
 *  `flaggedRootIds` so the UI can show it as broken rather than intentional. */
export function buildSalesOrgTree(
  people: SalesPerson[],
  postings: Record<string, SalesPosting>,
): SalesOrgTree {
  const byId = new Map(people.map((p) => [p.id, p]))
  const rawManagerOf = new Map<string, string | null>()
  const resolvedManagerOf = new Map<string, string | null>()
  for (const p of people) {
    const raw = postings[p.id]?.managerId ?? null
    rawManagerOf.set(p.id, raw)
    resolvedManagerOf.set(p.id, raw && byId.has(raw) ? raw : null)
  }

  // Cycle detection over the resolved-manager graph. Each person has at most
  // one outgoing edge (their manager), so this is a simple functional-graph
  // walk: a person is a cycle member only if following managers from them
  // eventually loops back to themselves. Someone who merely reports (however
  // indirectly) to a cycle member is NOT a cycle member — they still nest
  // normally under that member once the cycle is broken below.
  const cycleMembers = new Set<string>()
  const state = new Map<string, 'visiting' | 'done'>()
  function visit(id: string, path: string[]) {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') {
      const idx = path.indexOf(id)
      for (const m of path.slice(idx)) cycleMembers.add(m)
      return
    }
    state.set(id, 'visiting')
    const next = resolvedManagerOf.get(id) ?? null
    if (next) visit(next, [...path, id])
    state.set(id, 'done')
  }
  for (const p of people) visit(p.id, [])

  const childrenOf = new Map<string, SalesPerson[]>()
  const roots: SalesPerson[] = []
  const flaggedRootIds = new Set<string>()

  for (const p of people) {
    if (cycleMembers.has(p.id)) {
      // A cycle can't be rendered as a tree — break it by treating every
      // member as its own root instead of picking a "winning" parent.
      roots.push(p)
      flaggedRootIds.add(p.id)
      continue
    }
    const managerId = resolvedManagerOf.get(p.id)
    if (managerId) {
      childrenOf.set(managerId, [...(childrenOf.get(managerId) ?? []), p])
    } else {
      roots.push(p)
      // A raw reference that didn't resolve to anyone in the live roster is
      // a broken link, not an intentional "top of the chain" — flag it
      // distinctly from a genuine no-manager root.
      if (rawManagerOf.get(p.id)) flaggedRootIds.add(p.id)
    }
  }

  for (const [, kids] of childrenOf) kids.sort((a, b) => a.name.localeCompare(b.name))
  roots.sort((a, b) => a.name.localeCompare(b.name))

  return { roots, childrenOf, flaggedRootIds }
}

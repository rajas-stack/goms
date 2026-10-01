// The Master Grid filter as the UI edits it. Persisted/queried form is a list of
// nodes AND-ed together, where a node is a rule or a `{logic, rules}` group
// (see `FilterNode` in @goms/domain). The builder adds one convenience on top:
// a ROOT connective. "Match any" is stored as a single OR group wrapping the
// list — logically identical to an OR at the top, and it needs no new shape,
// so saved views, the API schema and the evaluator stay as they are.
import { isFilterGroup, type FilterGroup, type FilterNode, type TypedFilterRule } from '@goms/domain'

export interface RootFilter { logic: 'and' | 'or'; items: FilterNode[] }

export function toRoot(nodes: FilterNode[]): RootFilter {
  const only = nodes.length === 1 ? nodes[0] : undefined
  if (only && isFilterGroup(only) && only.logic === 'or') return { logic: 'or', items: only.rules }
  return { logic: 'and', items: nodes }
}

export function fromRoot(root: RootFilter): FilterNode[] {
  if (root.logic === 'and') return root.items
  return root.items.length ? [{ logic: 'or', rules: root.items }] : []
}

export const otherLogic = (logic: 'and' | 'or'): 'and' | 'or' => (logic === 'and' ? 'or' : 'and')

/** Where an edit lands: a top-level index, or `[groupIndex, ruleIndex]` inside a group. */
export type NodePath = [number] | [number, number]

export const isGroup = (n: FilterNode): n is FilterGroup => isFilterGroup(n)

/** The rule at `path` (undefined if the path points at a group or nothing). */
export function ruleAt(items: FilterNode[], path: NodePath): TypedFilterRule | undefined {
  const top = items[path[0]]
  if (!top) return undefined
  if (path.length === 1) return isFilterGroup(top) ? undefined : top
  return isFilterGroup(top) ? (top.rules[path[1]] as TypedFilterRule | undefined) : undefined
}

export function removeAt(items: FilterNode[], path: NodePath): FilterNode[] {
  if (path.length === 1) return items.filter((_, i) => i !== path[0])
  return items.flatMap((n, i) => {
    if (i !== path[0] || !isFilterGroup(n)) return [n]
    const rules = n.rules.filter((_, j) => j !== path[1])
    return rules.length ? [{ ...n, rules }] : [] // an emptied group disappears
  })
}

/** Every rule with its path, in display order (for the chip bar). */
export function rulePaths(items: FilterNode[]): { rule: TypedFilterRule; path: NodePath }[] {
  return items.flatMap((n, i) => (isFilterGroup(n)
    ? n.rules.flatMap((r, j) => (isFilterGroup(r) ? [] : [{ rule: r, path: [i, j] as NodePath }]))
    : [{ rule: n, path: [i] as NodePath }]))
}

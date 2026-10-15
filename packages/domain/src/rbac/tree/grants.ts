import {
  RBAC_ACTIONS, type RbacAction, type RbacActionMask, type RbacCellValue, type RbacEffect, type RbacGrant, type RbacGrantChange,
  type RbacGrantMap,
} from './types.js'

export const isRbacAction = (value: unknown): value is RbacAction => typeof value === 'string' && (RBAC_ACTIONS as readonly string[]).includes(value)
export const isRbacEffect = (value: unknown): value is RbacEffect => value === 'allow' || value === 'deny'

/** Keys of a node id: lower/upper letters, digits, `_`, `-`, `:` — never a dot. */
const KEY_PATTERN = /^[A-Za-z0-9_:-]+$/
export const RBAC_NODE_ID_MAX = 300

/** Is `key` usable as one segment of a node id? */
export const isNodeKey = (key: string): boolean => KEY_PATTERN.test(key)
/** Is `id` a well-formed dotted node id? */
export const isNodeId = (id: string): boolean => id.length > 0 && id.length <= RBAC_NODE_ID_MAX && id.split('.').every(isNodeKey)
/** The parent derived from a dotted id (`a.b.c` → `a.b`), or null for a root. */
export const parentOfNodeId = (id: string): string | null => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null)
export const childNodeId = (parentId: string | null, key: string): string => (parentId ? `${parentId}.${key}` : key)

/** A list of grants as a lookup map. A later duplicate wins. */
export function toGrantMap(grants: readonly RbacGrant[]): RbacGrantMap {
  const map: Record<string, Partial<Record<RbacAction, RbacEffect>>> = {}
  for (const g of grants) map[g.nodeId] = { ...map[g.nodeId], [g.action]: g.effect }
  return map
}

/** A grant map as a sorted list (stable for diffs, tests and storage). */
export function fromGrantMap(map: RbacGrantMap): RbacGrant[] {
  const out: RbacGrant[] = []
  for (const nodeId of Object.keys(map).sort()) {
    for (const action of RBAC_ACTIONS) {
      const effect = map[nodeId]?.[action]
      if (effect) out.push({ nodeId, action, effect })
    }
  }
  return out
}

export const cellValue = (map: RbacGrantMap, nodeId: string, action: RbacAction): RbacCellValue => map[nodeId]?.[action] ?? 'inherit'

/** Returns a new map with `changes` applied (`inherit` removes the entry). The input is never modified. */
export function applyGrantChanges(map: RbacGrantMap, changes: readonly RbacGrantChange[]): RbacGrantMap {
  const next: Record<string, Partial<Record<RbacAction, RbacEffect>>> = { ...map }
  for (const { nodeId, action, value } of changes) {
    const { [action]: _removed, ...rest } = next[nodeId] ?? {}
    const row = value === 'inherit' ? rest : { ...rest, [action]: value }
    if (Object.keys(row).length === 0) delete next[nodeId]
    else next[nodeId] = row
  }
  return next
}

/** The cell changes that turn `before` into `after` (sorted by node, then action order). */
export function diffGrantMaps(before: RbacGrantMap, after: RbacGrantMap): RbacGrantChange[] {
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  const changes: RbacGrantChange[] = []
  for (const nodeId of ids) {
    for (const action of RBAC_ACTIONS) {
      const a = cellValue(before, nodeId, action)
      const b = cellValue(after, nodeId, action)
      if (a !== b) changes.push({ nodeId, action, value: b })
    }
  }
  return changes
}

/** `top` wins wherever it has a value; `base` fills the rest. */
export function layerGrantMaps(top: RbacGrantMap, base: RbacGrantMap): RbacGrantMap {
  const out: Record<string, Partial<Record<RbacAction, RbacEffect>>> = { ...base }
  for (const [nodeId, row] of Object.entries(top)) out[nodeId] = { ...base[nodeId], ...row }
  return out
}

export const actionBit = (action: RbacAction): RbacActionMask => 1 << RBAC_ACTIONS.indexOf(action)
export const ALL_ACTIONS_MASK: RbacActionMask = (1 << RBAC_ACTIONS.length) - 1
export const maskAllows = (mask: RbacActionMask, action: RbacAction): boolean => (mask & actionBit(action)) !== 0
export const maskOf = (actions: Iterable<RbacAction>): RbacActionMask => {
  let mask = 0
  for (const a of actions) mask |= actionBit(a)
  return mask
}

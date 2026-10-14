import { ALL_ACTIONS_MASK, actionBit } from './grants.js'
import { RBAC_ACTIONS, type RbacAction, type RbacActionMask, type RbacEffect, type RbacGrantMap, type RbacMyAccess } from './types.js'

/** One precedence layer, e.g. "user", "role", "template". Within a layer, ALLOW wins over DENY across its maps (a user with
 *  several roles gets whatever any of those roles allows). */
export interface RbacLayer { name: string; maps: readonly RbacGrantMap[] }

/** Where a resolved value came from: an explicit value in `layer` at `nodeId` (this node or the ancestor it was inherited
 *  from), or the root default (`layer: 'default'`, `nodeId: null`). */
export interface RbacValueSource { layer: string; nodeId: string | null }

export interface RbacResolvedCell {
  /** The final answer, after View gating. */
  allowed: boolean
  /** The value before View gating (what this cell resolves to on its own). */
  effect: RbacEffect
  /** True when a layer set this cell on this very node. */
  explicit: boolean
  source: RbacValueSource
}

export interface RbacResolvedNode {
  cells: Record<RbacAction, RbacResolvedCell>
  /** The nearest node (this one or an ancestor) whose View resolves to deny, which hides this node; null when viewable. */
  hiddenBy: string | null
}

export type RbacResolution = ReadonlyMap<string, RbacResolvedNode>

interface TreeNode { id: string; parentId: string | null }

const DEFAULT_SOURCE: RbacValueSource = { layer: 'default', nodeId: null }

/** The combined value of one layer for a cell: allow if any map allows, else deny if any denies, else none. */
function layerValue(layer: RbacLayer, nodeId: string, action: RbacAction): RbacEffect | null {
  let denied = false
  for (const map of layer.maps) {
    const v = map[nodeId]?.[action]
    if (v === 'allow') return 'allow'
    if (v === 'deny') denied = true
  }
  return denied ? 'deny' : null
}

function explicitValue(layers: readonly RbacLayer[], nodeId: string, action: RbacAction): { effect: RbacEffect; layer: string } | null {
  for (const layer of layers) {
    const v = layerValue(layer, nodeId, action)
    if (v) return { effect: v, layer: layer.name }
  }
  return null
}

/** Parents before children; a node whose parent is unknown is treated as a root. Cycles cannot form from dotted ids, but a
 *  malformed list is still resolved (each node is visited once). */
function topoOrder(nodes: readonly TreeNode[]): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string | null, TreeNode[]>()
  for (const n of nodes) {
    const parent = n.parentId && byId.has(n.parentId) && n.parentId !== n.id ? n.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), n])
  }
  const out: TreeNode[] = []
  const seen = new Set<string>()
  const stack = [...(children.get(null) ?? [])].reverse()
  while (stack.length) {
    const n = stack.pop()!
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
    for (const c of [...(children.get(n.id) ?? [])].reverse()) stack.push(c)
  }
  return out
}

/**
 * Resolves every node and action. Per cell the first explicit value wins, in `layers` order; otherwise the cell inherits
 * its parent's value; a root without a value is ALLOWED. Then View gating: a node is viewable only when it and every
 * ancestor resolve View to allow, and every other action also requires the node to be viewable.
 */
export function resolveTree(nodes: readonly TreeNode[], layers: readonly RbacLayer[]): RbacResolution {
  const out = new Map<string, RbacResolvedNode>()
  for (const node of topoOrder(nodes)) {
    const parent = node.parentId ? out.get(node.parentId) : undefined
    const raw = {} as Record<RbacAction, Omit<RbacResolvedCell, 'allowed'>>
    for (const action of RBAC_ACTIONS) {
      const own = explicitValue(layers, node.id, action)
      if (own) raw[action] = { effect: own.effect, explicit: true, source: { layer: own.layer, nodeId: node.id } }
      else if (parent) raw[action] = { effect: parent.cells[action].effect, explicit: false, source: parent.cells[action].source }
      else raw[action] = { effect: 'allow', explicit: false, source: DEFAULT_SOURCE }
    }
    const hiddenBy = parent?.hiddenBy ?? (raw.view.effect === 'deny' ? node.id : null)
    const cells = {} as Record<RbacAction, RbacResolvedCell>
    for (const action of RBAC_ACTIONS) cells[action] = { ...raw[action], allowed: hiddenBy === null && raw[action].effect === 'allow' }
    out.set(node.id, { cells, hiddenBy })
  }
  return out
}

export const resolvedMask = (node: RbacResolvedNode): RbacActionMask =>
  RBAC_ACTIONS.reduce((mask, a) => (node.cells[a].allowed ? mask | actionBit(a) : mask), 0)

/** True when any of the maps holds at least one grant. */
export const hasAnyGrant = (maps: readonly RbacGrantMap[]): boolean => maps.some((m) => Object.values(m).some((row) => Object.keys(row).length > 0))

export interface UserTreeInput {
  nodes: readonly TreeNode[]
  /** The user's own overrides. */
  user: RbacGrantMap
  /** One map per role the user holds (functional and custom). */
  roles: readonly RbacGrantMap[]
  /** One map per template linked to the user or to any of their roles. */
  templates: readonly RbacGrantMap[]
}

/** The precedence of the tree: user override > role configs > template defaults (then parent, then allow). */
export const userLayers = (input: Omit<UserTreeInput, 'nodes'>): RbacLayer[] => [
  { name: 'user', maps: [input.user] },
  { name: 'role', maps: input.roles },
  { name: 'template', maps: input.templates },
]

/** What the browser enforces for one user. With no applicable grant, nothing is restricted (`configured: false`). */
export function resolveMyAccess(input: UserTreeInput): RbacMyAccess {
  const configured = hasAnyGrant([input.user, ...input.roles, ...input.templates])
  if (!configured) return { configured: false, allowed: {} }
  const resolution = resolveTree(input.nodes, userLayers(input))
  const allowed: Record<string, RbacActionMask> = {}
  for (const [id, node] of resolution) allowed[id] = resolvedMask(node)
  return { configured: true, allowed }
}

/** Is `action` allowed on `nodeId`? Unknown nodes resolve through their nearest known ancestor (dotted ids), which is exactly
 *  what inheritance gives a node that has no grant of its own. Unconfigured access allows everything. */
export function treeAllows(access: RbacMyAccess | null | undefined, nodeId: string, action: RbacAction = 'view'): boolean {
  if (!access || !access.configured) return true
  let id: string | null = nodeId
  while (id !== null) {
    const mask = access.allowed[id]
    if (mask !== undefined) return (mask & actionBit(action)) !== 0
    id = id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null
  }
  return (ALL_ACTIONS_MASK & actionBit(action)) !== 0
}

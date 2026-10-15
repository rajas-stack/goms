import {
  DEFAULT_NODE_ACTIONS, childNodeId, isNodeKey, type RbacAction, type RbacNodeDef, type RbacNodeDynamic, type RbacNodeKind,
} from '@goms/domain'

/**
 * The UI permission-tree registry (docs/superpowers/specs/2026-10-14-dynamic-rbac-design.md §3). Declaration sites pass the
 * SAME arrays that render their tabs / sections through `definePermissionNodes`, so adding a tab adds its node. Everything
 * registered here is collected by `npm run rbac:manifest` into packages/domain/src/rbac/tree/manifest.generated.ts, and
 * manifest.test.tsx fails when that file is stale.
 */

export interface NodeOptions { kind?: RbacNodeKind; actions?: readonly RbacAction[]; dynamic?: RbacNodeDynamic }

interface Entry { def: Omit<RbacNodeDef, 'order'>; seq: number }

const entries = new Map<string, Entry>()
let sequence = 0

/** Registers one node (idempotent: re-declaring an id replaces its definition and keeps its position). Returns its id. */
export function defineNode(parentId: string | null, key: string, label: string, opts: NodeOptions = {}): string {
  if (!isNodeKey(key)) throw new Error(`RBAC node key "${key}" may only use letters, digits, "_", "-" and ":".`)
  const id = childNodeId(parentId, key)
  const kind = opts.kind ?? (parentId ? 'section' : 'module')
  const def: Omit<RbacNodeDef, 'order'> = {
    id, parentId, label, kind, actions: [...(opts.actions ?? DEFAULT_NODE_ACTIONS[kind])],
    ...(opts.dynamic ? { dynamic: opts.dynamic } : {}),
  }
  entries.set(id, { def, seq: entries.get(id)?.seq ?? sequence++ })
  return id
}

/** A section / action area, declared at module scope and guarded with `<Secured node={id}>` / `useNodeAccess(id)`. */
export const defineSection = (parentId: string, key: string, label: string, opts: NodeOptions = {}): string =>
  defineNode(parentId, key, label, { kind: 'section', ...opts })

type Keyed = { value?: string; key?: string; id?: string; label?: string; title?: string; name?: string }

export interface ItemsOptions<T> extends NodeOptions {
  key?: (item: T) => string
  label?: (item: T) => string
}

/** Registers one node per item under `parent` (or under each of several parents) and returns `items` unchanged, so the
 *  declaration that renders a tab bar is also the declaration of its nodes. */
export function definePermissionNodes<T extends readonly Keyed[]>(parent: string | null | readonly string[], items: T, opts: ItemsOptions<T[number]> = {}): T {
  const parents = Array.isArray(parent) ? parent : [parent as string | null]
  const keyOf = opts.key ?? ((i: T[number]) => String(i.value ?? i.key ?? i.id))
  const labelOf = opts.label ?? ((i: T[number]) => String(i.label ?? i.title ?? i.name ?? keyOf(i)))
  for (const p of parents) for (const item of items) defineNode(p, keyOf(item), labelOf(item), { kind: p ? 'tab' : 'module', ...opts })
  return items
}

/** The node id an item of a `definePermissionNodes` call got. */
export const nodeIdFor = (parentId: string | null, key: string): string => childNodeId(parentId, key)

/** Everything registered so far, parents before children, siblings in declaration order. */
export function declaredNodes(): RbacNodeDef[] {
  const all = [...entries.values()].sort((a, b) => a.seq - b.seq)
  const children = new Map<string | null, Entry[]>()
  for (const e of all) {
    const parent = e.def.parentId && entries.has(e.def.parentId) ? e.def.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), e])
  }
  const out: RbacNodeDef[] = []
  const walk = (parent: string | null) => (children.get(parent) ?? []).forEach((e, order) => { out.push({ ...e.def, order }); walk(e.def.id) })
  walk(null)
  return out
}

export const isDeclared = (id: string): boolean => entries.has(id)

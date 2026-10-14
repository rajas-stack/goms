import { SYSTEM_BID_VIEWS } from '../../bids.js'
import { DEFAULT_NODE_ACTIONS, type RbacNode } from './types.js'

/** The fields of a saved view the tree needs (system views carry `sheet: 'all'` and show on every sheet). */
export interface SavedViewLike { id: string; name: string; sheet: string; isSystem?: boolean }

/** A saved view's node under a sheet's Views node. View ids are uuids / `bsv_…` / system keys; anything outside the key
 *  alphabet is replaced so the id stays a well-formed dotted path. */
export const savedViewNodeId = (viewsNodeId: string, viewId: string): string => `${viewsNodeId}.${viewId.replace(/[^A-Za-z0-9_:-]/g, '_')}`

/**
 * Adds the data-driven children of every `dynamic` node: the system views (on every sheet) and the user views of that
 * node's sheet. Returns a new list; the input is not modified. A child inherits its parent's retired state.
 */
export function expandDynamicNodes(nodes: readonly RbacNode[], views: readonly SavedViewLike[]): RbacNode[] {
  const out: RbacNode[] = [...nodes]
  const known = new Set(nodes.map((n) => n.id))
  for (const parent of nodes) {
    if (parent.dynamic?.source !== 'savedViews') continue
    const sheet = parent.dynamic.sheet
    const system = SYSTEM_BID_VIEWS.map((v) => ({ id: v.key, name: v.name }))
    const own = views.filter((v) => !v.isSystem && v.sheet === sheet).map((v) => ({ id: v.id, name: v.name }))
    ;[...system, ...own].forEach((view, order) => {
      const id = savedViewNodeId(parent.id, view.id)
      if (known.has(id)) return
      known.add(id)
      out.push({
        id, parentId: parent.id, label: view.name, kind: 'view', actions: [...DEFAULT_NODE_ACTIONS.view], order,
        retired: parent.retired, runtime: true,
      })
    })
  }
  return out
}

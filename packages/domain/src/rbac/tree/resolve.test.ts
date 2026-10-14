import { describe, expect, it } from 'vitest'
import { applyGrantChanges, diffGrantMaps, maskAllows, parentOfNodeId, toGrantMap } from './grants.js'
import { resolveMyAccess, resolveTree, treeAllows, userLayers } from './resolve.js'
import { expandDynamicNodes } from './dynamic.js'
import type { RbacNode } from './types.js'

const NODES = ['opp', 'opp.bt', 'opp.bt.grid', 'opp.bt.grid.views', 'opp.bid', 'am'].map((id) => ({ id, parentId: parentOfNodeId(id) }))
const g = (nodeId: string, action: any, effect: 'allow' | 'deny') => toGrantMap([{ nodeId, action, effect }])

describe('resolveTree', () => {
  it('allows everything when nothing is configured', () => {
    expect(resolveMyAccess({ nodes: NODES, user: {}, roles: [], templates: [] })).toEqual({ configured: false, allowed: {} })
    expect(treeAllows({ configured: false, allowed: {} }, 'anything', 'delete')).toBe(true)
  })
  it('inherits a parent deny and lets an explicit child override it', () => {
    const role = toGrantMap([{ nodeId: 'opp', action: 'edit', effect: 'deny' }, { nodeId: 'opp.bt.grid', action: 'edit', effect: 'allow' }])
    const r = resolveTree(NODES, userLayers({ user: {}, roles: [role], templates: [] }))
    expect(r.get('opp.bt')!.cells.edit).toMatchObject({ allowed: false, explicit: false, source: { layer: 'role', nodeId: 'opp' } })
    expect(r.get('opp.bt.grid')!.cells.edit.allowed).toBe(true)
    expect(r.get('opp.bt.grid.views')!.cells.edit.allowed).toBe(true)
  })
  it('hides the whole subtree when View is denied on a parent, even over a child allow', () => {
    const role = toGrantMap([{ nodeId: 'opp.bt', action: 'view', effect: 'deny' }, { nodeId: 'opp.bt.grid', action: 'view', effect: 'allow' }])
    const r = resolveTree(NODES, userLayers({ user: {}, roles: [role], templates: [] }))
    expect(r.get('opp.bt.grid')!.hiddenBy).toBe('opp.bt')
    expect(r.get('opp.bt.grid')!.cells.view.allowed).toBe(false)
    expect(r.get('opp.bt.grid')!.cells.create.allowed).toBe(false)
    expect(r.get('opp.bid')!.cells.view.allowed).toBe(true)
  })
  it('allow wins across roles, the user override wins over roles, roles win over templates', () => {
    const roles = [g('opp', 'delete', 'deny'), g('opp', 'delete', 'allow')]
    expect(resolveTree(NODES, userLayers({ user: {}, roles, templates: [] })).get('opp')!.cells.delete.allowed).toBe(true)
    expect(resolveTree(NODES, userLayers({ user: g('opp', 'delete', 'deny'), roles, templates: [] })).get('opp')!.cells.delete.allowed).toBe(false)
    const t = resolveTree(NODES, userLayers({ user: {}, roles: [g('am', 'view', 'allow')], templates: [g('am', 'view', 'deny')] }))
    expect(t.get('am')!.cells.view.allowed).toBe(true)
    expect(resolveTree(NODES, userLayers({ user: {}, roles: [], templates: [g('am', 'view', 'deny')] })).get('am')!.cells.view.allowed).toBe(false)
  })
  it('resolves an unknown node through its nearest known ancestor', () => {
    const access = resolveMyAccess({ nodes: NODES, user: g('opp.bt.grid.views', 'view', 'deny'), roles: [], templates: [] })
    expect(maskAllows(access.allowed['opp.bt']!, 'view')).toBe(true)
    expect(treeAllows(access, 'opp.bt.grid.views.bsv_new', 'view')).toBe(false)
    expect(treeAllows(access, 'opp.bt.grid.other', 'view')).toBe(true)
  })
})

describe('grant helpers', () => {
  it('applies and diffs changes immutably', () => {
    const before = g('opp', 'view', 'deny')
    const after = applyGrantChanges(before, [{ nodeId: 'opp', action: 'view', value: 'inherit' }, { nodeId: 'am', action: 'edit', value: 'allow' }])
    expect(before).toEqual(g('opp', 'view', 'deny'))
    expect(after).toEqual(g('am', 'edit', 'allow'))
    expect(diffGrantMaps(before, after)).toEqual([
      { nodeId: 'am', action: 'edit', value: 'allow' }, { nodeId: 'opp', action: 'view', value: 'inherit' },
    ])
  })
})

describe('expandDynamicNodes', () => {
  it('adds system views and the sheet\'s own user views under a dynamic node', () => {
    const views: RbacNode = { id: 'opp.bt.grid.views', parentId: 'opp.bt.grid', label: 'Views', kind: 'section', actions: ['view'], order: 0, retired: false, runtime: false, dynamic: { source: 'savedViews', sheet: 'bidTracker' } }
    const out = expandDynamicNodes([views], [{ id: 'bsv_1', name: 'Mine', sheet: 'bidTracker' }, { id: 'bsv_2', name: 'Other', sheet: 'campaign' }])
    const ids = out.map((n) => n.id)
    expect(ids).toContain('opp.bt.grid.views.allBids')
    expect(ids).toContain('opp.bt.grid.views.bsv_1')
    expect(ids).not.toContain('opp.bt.grid.views.bsv_2')
  })
})

import { syncNodeList } from './sync.js'
describe('syncNodeList', () => {
  it('adds, retires (never removes) and restores nodes', () => {
    const def = (id: string) => ({ id, parentId: parentOfNodeId(id), label: id, kind: 'page' as const, actions: ['view' as const], order: 0 })
    const first = syncNodeList([], [def('a'), def('a.b')])
    expect(first.result).toMatchObject({ added: 2 })
    const second = syncNodeList(first.nodes, [def('a')])
    expect(second.result).toMatchObject({ retired: 1 })
    expect(second.nodes.find((n) => n.id === 'a.b')).toMatchObject({ retired: true })
    expect(syncNodeList(second.nodes, [def('a'), def('a.b')]).result).toMatchObject({ restored: 1 })
  })
})

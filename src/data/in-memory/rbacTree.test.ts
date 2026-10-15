import { describe, expect, it } from 'vitest'
import { treeAllows } from '@goms/domain'
import {
  applyLocalTemplate, createLocalRole, createLocalTemplate, emptyRbacState, getLocalConfig, localMyAccess, localSubjects, setLocalConfig,
} from './rbacTree'

const views = [{ id: 'bsv_1', name: 'Mine', sheet: 'bidTracker' }]

describe('local permission-tree store', () => {
  it('allows everything until something is configured', () => {
    expect(localMyAccess(emptyRbacState(), views, 'a@amnex.com')).toEqual({ configured: false, allowed: {} })
  })

  it('applies a user override and a custom role by membership, immutably', () => {
    const start = emptyRbacState()
    const { state: withRole, role } = createLocalRole(start, { label: 'Auditors', members: ['B@amnex.com'] })
    expect(start.roles).toEqual([])
    const s = setLocalConfig(withRole, { type: 'role', id: role.id }, [{ nodeId: 'opportunity', action: 'delete', value: 'deny' }])
    const access = localMyAccess(s, views, 'b@amnex.com')
    expect(treeAllows(access, 'opportunity.bid', 'delete')).toBe(false)
    expect(treeAllows(access, 'opportunity.bid', 'view')).toBe(true)
    expect(localMyAccess(s, views, 'c@amnex.com').configured).toBe(false)
  })

  it('links a template (save-as, apply with replace) so template edits reach linked users', () => {
    let s = setLocalConfig(emptyRbacState(), { type: 'user', id: 'x@amnex.com' }, [{ nodeId: 'commercial', action: 'view', value: 'deny' }])
    const created = createLocalTemplate(s, { name: 'No commercial', from: { type: 'user', id: 'x@amnex.com' } })
    s = applyLocalTemplate(created.state, { templateId: created.id, subjects: [{ type: 'user', id: 'y@amnex.com' }, { type: 'user', id: 'x@amnex.com' }], mode: 'replace' })
    expect(getLocalConfig(s, { type: 'user', id: 'x@amnex.com' })).toMatchObject({ grants: [], templateId: created.id })
    expect(treeAllows(localMyAccess(s, views, 'y@amnex.com'), 'commercial.dashboard')).toBe(false)
    s = setLocalConfig(s, { type: 'template', id: created.id }, [{ nodeId: 'commercial', action: 'view', value: 'inherit' }])
    expect(localMyAccess(s, views, 'y@amnex.com').configured).toBe(false)
    expect(localSubjects(s).templates[0].links).toHaveLength(2)
  })
})

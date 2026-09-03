import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('hierarchy router', () => {
  beforeEach(async () => {
    // employees.org_node_id, commercial_boqs.department_id, and
    // opportunities.department_id all FK (RESTRICT) into hierarchy_nodes —
    // clear dependents first so this file's cleanup doesn't conflict with
    // rows left behind by employees.test.ts, commercial-boq.test.ts (Phase 6),
    // or opportunities.test.ts/ownership.test.ts/search.test.ts (Phase 7).
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
  })

  async function makeNode(overrides: Partial<{ domain: 'geo' | 'org' | 'sales'; typeKey: string; parentId: string | null; stateCode: number | null; name: string }> = {}) {
    const caller = appRouter.createCaller({})
    return caller.hierarchy.createNode({
      domain: overrides.domain ?? 'org',
      typeKey: overrides.typeKey ?? 'department',
      parentId: overrides.parentId ?? null,
      stateCode: overrides.stateCode ?? 27,
      name: overrides.name ?? 'IT Department',
    })
  }

  it('creates a node and fetches it by id', async () => {
    const caller = appRouter.createCaller({})
    const created = await makeNode()
    const fetched = await caller.hierarchy.getNode({ id: created.id })
    expect(fetched?.name).toBe('IT Department')
    expect(fetched?.sortOrder).toBe(0)
  })

  it('returns null for a missing node', async () => {
    const caller = appRouter.createCaller({})
    const missing = await caller.hierarchy.getNode({ id: '00000000-0000-0000-0000-000000000000' })
    expect(missing).toBeNull()
  })

  it('assigns increasing sortOrder to siblings', async () => {
    const caller = appRouter.createCaller({})
    const parent = await makeNode()
    const a = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: parent.id, stateCode: 27, name: 'Branch A' })
    const b = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: parent.id, stateCode: 27, name: 'Branch B' })
    expect(a.sortOrder).toBe(0)
    expect(b.sortOrder).toBe(1)
  })

  it('dedupes a branch created twice under the same parent with the same name', async () => {
    const caller = appRouter.createCaller({})
    const parent = await makeNode()
    const first = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: parent.id, stateCode: 27, name: 'Branch A' })
    const second = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: parent.id, stateCode: 27, name: 'branch a' })
    expect(second.id).toBe(first.id)
  })

  it('builds a breadcrumb from root to leaf', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    const crumb = await caller.hierarchy.breadcrumb({ id: branch.id })
    expect(crumb.map((n) => n.name)).toEqual(['Dept', 'Branch'])
  })

  it('rejects moving a node into its own subtree', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    await expect(caller.hierarchy.moveNode({ id: dept.id, newParentId: branch.id })).rejects.toThrow()
  })

  it('moves a node to a valid new parent', async () => {
    const caller = appRouter.createCaller({})
    const deptA = await makeNode({ typeKey: 'department', name: 'Dept A' })
    const deptB = await makeNode({ typeKey: 'department', name: 'Dept B' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: deptA.id, stateCode: 27, name: 'Branch' })
    await caller.hierarchy.moveNode({ id: branch.id, newParentId: deptB.id })
    const moved = await caller.hierarchy.getNode({ id: branch.id })
    expect(moved?.parentId).toBe(deptB.id)
  })

  it('cascade-deletes an entire subtree in one call', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    const office = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: branch.id, stateCode: 27, name: 'Office' })
    await caller.hierarchy.deleteNode({ id: dept.id })
    expect(await caller.hierarchy.getNode({ id: dept.id })).toBeNull()
    expect(await caller.hierarchy.getNode({ id: branch.id })).toBeNull()
    expect(await caller.hierarchy.getNode({ id: office.id })).toBeNull()
  })

  it('duplicates a subtree with new ids and a "(Copy)" suffix on the root', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    const clone = await caller.hierarchy.duplicateNode({ id: dept.id })
    expect(clone.id).not.toBe(dept.id)
    expect(clone.name).toBe('Dept (Copy)')
    const clonedChildren = await caller.hierarchy.listChildren({ parentId: clone.id })
    expect(clonedChildren).toHaveLength(1)
    expect(clonedChildren[0].id).not.toBe(branch.id)
    expect(clonedChildren[0].name).toBe('Branch')
  })

  it('reorders a node before a given sibling', async () => {
    const caller = appRouter.createCaller({})
    const parent = await makeNode()
    const a = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: parent.id, stateCode: 27, name: 'A' })
    const b = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: parent.id, stateCode: 27, name: 'B' })
    await caller.hierarchy.reorderNode({ id: b.id, beforeId: a.id })
    const children = await caller.hierarchy.listChildren({ parentId: parent.id })
    expect(children.map((c) => c.name)).toEqual(['B', 'A'])
  })

  it('imports child rows, matching the row type case-insensitively, skipping blanks, falling back to the default child type', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const added = await caller.hierarchy.importChildren({
      parentId: dept.id,
      rows: [{ name: 'Branch One' }, { name: '' }, { name: 'Branch Two', type: 'Branch' }],
    })
    expect(added).toBe(2) // blank row skipped
    const children = await caller.hierarchy.listChildren({ parentId: dept.id })
    expect(children.map((c) => c.typeKey)).toEqual(['branch', 'branch'])
  })

  it('lists valid move targets, excluding the moved node\'s own subtree', async () => {
    const caller = appRouter.createCaller({})
    // department.childKeys=['branch'], so a department is a valid target for
    // moving a branch — moveTargets doesn't exclude the current parent, only
    // the node's own subtree (verified by hand against NODE_TYPE_MAP).
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const otherDept = await makeNode({ typeKey: 'department', name: 'Other Dept' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    const targets = await caller.hierarchy.moveTargets({ nodeId: branch.id })
    const ids = targets.map((t) => t.id)
    expect(ids).toContain(dept.id)
    expect(ids).toContain(otherDept.id)
    expect(ids).not.toContain(branch.id)
  })

  it('excludes cross-domain and cross-state nodes from move targets', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept', stateCode: 27 })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    const otherStateDept = await makeNode({ typeKey: 'department', name: 'Other State Dept', stateCode: 9 })
    const geoNode = await makeNode({ domain: 'geo', typeKey: 'country', name: 'India', stateCode: null })
    const targets = await caller.hierarchy.moveTargets({ nodeId: branch.id })
    const ids = targets.map((t) => t.id)
    expect(ids).not.toContain(otherStateDept.id)
    expect(ids).not.toContain(geoNode.id)
  })

  it('lists org roots (departments) for a state, sorted by sortOrder', async () => {
    const caller = appRouter.createCaller({})
    await makeNode({ typeKey: 'department', name: 'Dept B', stateCode: 27 })
    await makeNode({ typeKey: 'department', name: 'Dept A', stateCode: 27 })
    await makeNode({ typeKey: 'department', name: 'Other State', stateCode: 9 })
    const roots = await caller.hierarchy.listOrgRoots({ stateCode: 27 })
    expect(roots.map((r) => r.name)).toEqual(['Dept B', 'Dept A'])
  })

  it('reports childCounts for each active child in one call', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const branchA = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'A' })
    await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'B' })
    await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: branchA.id, stateCode: 27, name: 'Office' })
    const counts = await caller.hierarchy.childCounts({ parentId: dept.id })
    expect(counts[branchA.id]).toBe(1)
  })

  it('setNodeStatus cascades to the whole subtree', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    await caller.hierarchy.setNodeStatus({ id: dept.id, status: 'archived' })
    expect((await caller.hierarchy.getNode({ id: dept.id }))?.status).toBe('archived')
    expect((await caller.hierarchy.getNode({ id: branch.id }))?.status).toBe('archived')
    expect(await caller.hierarchy.listChildren({ parentId: dept.id })).toHaveLength(0)
  })

  it('updates node name and metadata', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const updated = await caller.hierarchy.updateNode({ id: dept.id, patch: { name: 'Renamed', metadata: { region: 'west' } } })
    expect(updated.name).toBe('Renamed')
    expect(updated.metadata).toEqual({ region: 'west' })
  })

  it('listStates reports real active, non-vacant employee counts', async () => {
    const caller = appRouter.createCaller({})
    await makeNode({ typeKey: 'state', name: 'Test State', stateCode: 27, domain: 'geo' })
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    await caller.employees.create({ name: 'A', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: null })
    await caller.employees.create({ name: 'B', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: null, vacant: true })
    const states = await caller.hierarchy.listStates()
    expect(states.find((s) => s.code === 27)?.employees).toBe(1)
  })

  it('getState(0) resolves once the Central Ministries virtual state node exists', async () => {
    // Regression test for the 2026-08-31 production bug: StateWorkspace.tsx's
    // `useStateNode(stateCode)` calls exactly this procedure, and treats a
    // null result as "no such state" -- rendering "No state found for code
    // {code}" instead of the Organization tab, even when that state's org
    // nodes (departments/branches/units) exist and are independently
    // reachable via listOrgRoots. Before the geography import fix
    // (buildGeographyRows() in apps/api/src/import/domains/geography.ts),
    // no import path ever created this row for stateCode 0.
    const caller = appRouter.createCaller({})
    expect(await caller.hierarchy.getState({ code: 0 })).toBeNull()
    await makeNode({ domain: 'geo', typeKey: 'state', stateCode: 0, name: 'Central Ministries (Govt. of India)' })
    const state = await caller.hierarchy.getState({ code: 0 })
    expect(state?.name).toBe('Central Ministries (Govt. of India)')
  })

  it('deleteNode cascades to employees under the deleted subtree', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    const emp = await caller.employees.create({ name: 'A', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: null })
    await caller.hierarchy.deleteNode({ id: dept.id })
    expect(await caller.employees.get({ id: emp.id })).toBeNull()
  })

  // 2026-08-26 backend hardening pass.

  it('creating the same branch name under the same parent concurrently never produces two nodes (serialized by an advisory lock)', async () => {
    const caller1 = appRouter.createCaller({})
    const caller2 = appRouter.createCaller({})
    const parent = await makeNode()
    const [a, b] = await Promise.all([
      caller1.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: parent.id, stateCode: 27, name: 'Branch A' }),
      caller2.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: parent.id, stateCode: 27, name: 'branch a' }),
    ])
    expect(a.id).toBe(b.id)
    const children = await caller1.hierarchy.listChildren({ parentId: parent.id })
    expect(children).toHaveLength(1)
  })

  it('never creates a parent_id cycle when two nodes are moved under each other concurrently', async () => {
    const caller = appRouter.createCaller({})
    const root = await makeNode({ typeKey: 'department', name: 'Root' })
    const x = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: root.id, stateCode: 27, name: 'X' })
    const y = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: root.id, stateCode: 27, name: 'Y' })

    const results = await Promise.allSettled([
      caller.hierarchy.moveNode({ id: x.id, newParentId: y.id }),
      caller.hierarchy.moveNode({ id: y.id, newParentId: x.id }),
    ])
    // At most one of the two swaps can have actually landed — if both did,
    // X and Y would each be the other's parent, an unrecoverable cycle.
    const fulfilledCount = results.filter((r) => r.status === 'fulfilled').length
    expect(fulfilledCount).toBeLessThanOrEqual(1)

    const finalX = await caller.hierarchy.getNode({ id: x.id })
    const finalY = await caller.hierarchy.getNode({ id: y.id })
    expect(finalX!.parentId === y.id && finalY!.parentId === x.id).toBe(false)
  })

  it('deleteNode gives a friendly CONFLICT (not a raw error) when the subtree contains a node a past transfer still points at', async () => {
    // transfers.to_org_node_id is ON DELETE RESTRICT (employees.sql) and
    // isn't pre-checked by deleteNode's own subtree cleanup — this proves
    // the resulting 23503 is translated, not left as a raw unhandled error.
    const caller = appRouter.createCaller({})
    const deptA = await makeNode({ typeKey: 'department', name: 'Dept A' })
    const deptB = await makeNode({ typeKey: 'department', name: 'Dept B' })
    const deptC = await makeNode({ typeKey: 'department', name: 'Dept C' })
    const emp = await caller.employees.create({ name: 'A', designation: 'Officer', email: '', phone: '', orgNodeId: deptA.id, managerId: null })
    await caller.employees.transfers.transfer({ employeeId: emp.id, toOrgNodeId: deptB.id, toDesignation: 'Officer', effectiveDate: '2026-01-01', reason: 'reorg' })
    // Transfers on again, out of deptB — deptB is now empty, but a
    // historical transfers row still points at it via to_org_node_id.
    await caller.employees.transfers.transfer({ employeeId: emp.id, toOrgNodeId: deptC.id, toDesignation: 'Officer', effectiveDate: '2026-02-01', reason: 'reorg2' })
    await expect(caller.hierarchy.deleteNode({ id: deptB.id })).rejects.toThrow(/still referenced elsewhere/i)
  })

  // Department → Department nesting.

  it('creates a department nested under another department', async () => {
    const caller = appRouter.createCaller({})
    const parent = await makeNode({ typeKey: 'department', name: 'Electronics & IT' })
    const child = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: parent.id, stateCode: 27, name: 'Industry Bodies' })
    expect(child.parentId).toBe(parent.id)
    const crumb = await caller.hierarchy.breadcrumb({ id: child.id })
    expect(crumb.map((n) => n.name)).toEqual(['Electronics & IT', 'Industry Bodies'])
  })

  it('listOrgRoots excludes a department nested under another department', async () => {
    const caller = appRouter.createCaller({})
    const parent = await makeNode({ typeKey: 'department', name: 'Electronics & IT', stateCode: 27 })
    await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: parent.id, stateCode: 27, name: 'Industry Bodies' })
    const roots = await caller.hierarchy.listOrgRoots({ stateCode: 27 })
    expect(roots.map((r) => r.name)).toEqual(['Electronics & IT'])
  })

  it('moveTargets allows moving a department under another department', async () => {
    const caller = appRouter.createCaller({})
    const deptA = await makeNode({ typeKey: 'department', name: 'Electronics & IT', stateCode: 27 })
    const deptB = await makeNode({ typeKey: 'department', name: 'Industry Bodies', stateCode: 27 })
    const targets = await caller.hierarchy.moveTargets({ nodeId: deptB.id })
    expect(targets.map((t) => t.id)).toContain(deptA.id)
  })

  it('rejects createNode when the child type is not allowed under the parent type', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    // office isn't a valid direct child of department (needs a branch/division in between)
    await expect(
      caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Bad Office' }),
    ).rejects.toThrow()
  })

  it('rejects moveNode when the target parent does not allow the moved node\'s type', async () => {
    const caller = appRouter.createCaller({})
    const deptA = await makeNode({ typeKey: 'department', name: 'Dept A' })
    const deptB = await makeNode({ typeKey: 'department', name: 'Dept B' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: deptA.id, stateCode: 27, name: 'Branch' })
    const office = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: branch.id, stateCode: 27, name: 'Office' })
    // department only allows branch/department children, not office directly
    await expect(caller.hierarchy.moveNode({ id: office.id, newParentId: deptB.id })).rejects.toThrow()
  })

  it('importChildren respects the branch-name dedup rule createNode enforces, including duplicates within the same import batch', async () => {
    const caller = appRouter.createCaller({})
    const dept = await makeNode({ typeKey: 'department', name: 'Dept' })
    await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Existing Branch' })
    const added = await caller.hierarchy.importChildren({
      parentId: dept.id,
      rows: [
        { name: 'existing branch', type: 'Branch' }, // dupes the pre-existing branch
        { name: 'New Branch', type: 'Branch' },
        { name: 'new branch', type: 'Branch' }, // dupes the row immediately above, within the same batch
      ],
    })
    expect(added).toBe(1) // only "New Branch" is genuinely new
    const children = await caller.hierarchy.listChildren({ parentId: dept.id })
    expect(children.map((c) => c.name).sort()).toEqual(['Existing Branch', 'New Branch'])
  })
})

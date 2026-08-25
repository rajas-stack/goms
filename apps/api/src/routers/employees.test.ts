import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('employees router', () => {
  let orgNodeId: string
  let otherOrgNodeId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM employee_merge_audit')
    await pool.query('DELETE FROM transfers')
    await pool.query('DELETE FROM timeline_events')
    await pool.query('DELETE FROM employee_charges')
    // opportunities.department_id FKs (RESTRICT) into hierarchy_nodes too —
    // clear it first so this doesn't conflict with rows left behind by
    // opportunities.test.ts/ownership.test.ts/search.test.ts (Phase 7).
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    orgNodeId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Office A' })).id
    otherOrgNodeId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Office B' })).id
  })

  async function makeEmployee(overrides: Partial<{ name: string; designation: string; orgNodeId: string; managerId: string | null; vacant: boolean }> = {}) {
    const caller = appRouter.createCaller({})
    return caller.employees.create({
      name: overrides.name ?? 'Jane Doe', designation: overrides.designation ?? 'Officer',
      email: 'jane@example.com', phone: '9999999999',
      orgNodeId: overrides.orgNodeId ?? orgNodeId, managerId: overrides.managerId ?? null,
      vacant: overrides.vacant,
    })
  }

  it('creates an employee and logs a "joined" timeline event', async () => {
    const caller = appRouter.createCaller({})
    const emp = await makeEmployee()
    expect(emp.code).toMatch(/^EMP-NEW-\d{4}$/)
    expect(emp.status).toBe('active')
    const timeline = await caller.employees.timeline.listForEmployee({ employeeId: emp.id })
    expect(timeline.map((t) => t.type)).toEqual(['joined'])
  })

  it('does not log a "joined" event for a vacant posting', async () => {
    const caller = appRouter.createCaller({})
    const emp = await makeEmployee({ vacant: true })
    const timeline = await caller.employees.timeline.listForEmployee({ employeeId: emp.id })
    expect(timeline).toHaveLength(0)
  })

  it('gets an employee by id, and null for a missing one', async () => {
    const caller = appRouter.createCaller({})
    const emp = await makeEmployee()
    expect((await caller.employees.get({ id: emp.id }))?.name).toBe('Jane Doe')
    expect(await caller.employees.get({ id: '00000000-0000-0000-0000-000000000000' })).toBeNull()
  })

  it('lists employees under a subtree, including descendants', async () => {
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.breadcrumb({ id: orgNodeId }))[0]
    const emp = await makeEmployee()
    const under = await caller.employees.listUnder({ orgNodeId: dept.id })
    expect(under.map((e) => e.id)).toContain(emp.id)
  })

  it('rejects setManager when it would create a cycle', async () => {
    const caller = appRouter.createCaller({})
    const a = await makeEmployee({ name: 'A' })
    const b = await makeEmployee({ name: 'B', managerId: a.id })
    await expect(caller.employees.setManager({ employeeId: a.id, managerId: b.id })).rejects.toThrow()
  })

  it('rejects setManager pointing an employee at themselves', async () => {
    const caller = appRouter.createCaller({})
    const a = await makeEmployee({ name: 'A' })
    await expect(caller.employees.setManager({ employeeId: a.id, managerId: a.id })).rejects.toThrow()
  })

  it('re-parents direct reports to the removed manager\'s own manager on delete', async () => {
    const caller = appRouter.createCaller({})
    const grandparent = await makeEmployee({ name: 'GP' })
    const parent = await makeEmployee({ name: 'P', managerId: grandparent.id })
    const child = await makeEmployee({ name: 'C', managerId: parent.id })
    await caller.employees.delete({ id: parent.id })
    expect((await caller.employees.get({ id: child.id }))?.managerId).toBe(grandparent.id)
  })

  it('adds and removes a charge', async () => {
    const caller = appRouter.createCaller({})
    const emp = await makeEmployee()
    const charge = await caller.employees.addCharge({
      employeeId: emp.id,
      charge: { kind: 'acting', title: 'Acting Head', orgNodeId: null, startDate: '2026-01-01', endDate: null, reason: 'Vacancy' },
    })
    expect((await caller.employees.get({ id: emp.id }))?.charges).toHaveLength(1)
    await caller.employees.removeCharge({ employeeId: emp.id, chargeId: charge.id })
    expect((await caller.employees.get({ id: emp.id }))?.charges).toHaveLength(0)
  })

  it('merges a duplicate into a survivor: applies resolutions, auto-fills blanks, and reassigns timeline/reports', async () => {
    const caller = appRouter.createCaller({})
    const survivor = await makeEmployee({ name: 'Survivor' })
    const duplicate = await makeEmployee({ name: 'Duplicate' })
    const child = await makeEmployee({ name: 'Child', managerId: duplicate.id })
    await caller.employees.timeline.add({ employeeId: duplicate.id, type: 'call', title: 'Call', date: '2026-01-01' })

    const result = await caller.employees.merge({
      survivorId: survivor.id, duplicateId: duplicate.id,
      resolutions: { designation: 'Senior Officer' },
    })
    expect(result.survivor.designation).toBe('Senior Officer')
    expect(result.audit.transferred.directReports).toBe(1)
    // duplicate carries its own "joined" event (from create) plus the "call"
    // event added above — both get reassigned to the survivor.
    expect(result.audit.transferred.timelineEvents).toBe(2)
    expect((await caller.employees.get({ id: child.id }))?.managerId).toBe(survivor.id)
    expect(await caller.employees.get({ id: duplicate.id })).toBeNull()
    const survivorTimeline = await caller.employees.timeline.listForEmployee({ employeeId: survivor.id })
    expect(survivorTimeline.some((t) => t.title.includes('Call'))).toBe(true)
    const audits = await caller.employees.listMergeAudit()
    expect(audits[0].duplicateId).toBe(duplicate.id)
  })

  it('transfers an employee: appends a transfer record and moves the live posting', async () => {
    const caller = appRouter.createCaller({})
    const emp = await makeEmployee({ designation: 'Officer' })
    const transfer = await caller.employees.transfers.transfer({
      employeeId: emp.id, toOrgNodeId: otherOrgNodeId, toDesignation: 'Senior Officer',
      effectiveDate: '2026-02-01', reason: 'Promotion',
    })
    expect(transfer.toDesignation).toBe('Senior Officer')
    const updated = await caller.employees.get({ id: emp.id })
    expect(updated?.orgNodeId).toBe(otherOrgNodeId)
    expect(updated?.designation).toBe('Senior Officer')
    const timeline = await caller.employees.timeline.listForEmployee({ employeeId: emp.id })
    expect(timeline.some((t) => t.type === 'transferred')).toBe(true)
  })

  it('imports employee rows, skipping blank rows', async () => {
    const caller = appRouter.createCaller({})
    const added = await caller.employees.import({
      orgNodeId,
      rows: [{ name: 'Row One', designation: 'Clerk' }, { name: '', designation: 'Clerk' }, { name: 'Row Two', designation: 'Clerk' }],
    })
    expect(added).toBe(2)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('followUps router', () => {
  let empId: string
  let orgNodeId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM follow_ups')
    // opportunities.department_id FKs (RESTRICT) into hierarchy_nodes too —
    // clear it first so this doesn't conflict with rows left behind by
    // opportunities.test.ts.
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    orgNodeId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Office' })).id
    empId = (await caller.employees.create({ name: 'Jane', designation: 'Officer', email: 'j@x.com', phone: '1', orgNodeId, managerId: null })).id
  })

  it('creates a follow-up defaulting to open status', async () => {
    const caller = appRouter.createCaller({})
    const f = await caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-07-01' })
    expect(f.status).toBe('open')
    expect(f.assigneeId).toBeNull()
  })

  it('lists follow-ups for one entity, soonest due first', async () => {
    const caller = appRouter.createCaller({})
    await caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-08-01' })
    await caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-06-01' })
    const list = await caller.followUps.listForEntity({ entityType: 'contact', entityId: empId })
    expect(list.map((f) => f.dueDate)).toEqual(['2025-06-01', '2025-08-01'])
  })

  it('listOpen only returns open follow-ups, soonest first', async () => {
    const caller = appRouter.createCaller({})
    const a = await caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-08-01' })
    await caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-06-01' })
    await caller.followUps.setStatus({ id: a.id, status: 'done' })
    const open = await caller.followUps.listOpen()
    expect(open).toHaveLength(1)
    expect(open[0].dueDate).toBe('2025-06-01')
  })

  it('deletes a follow-up', async () => {
    const caller = appRouter.createCaller({})
    const f = await caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-08-01' })
    await caller.followUps.delete({ id: f.id })
    expect(await caller.followUps.listForEntity({ entityType: 'contact', entityId: empId })).toEqual([])
  })

  it('cascades entityType="contact" follow-ups when the employee is deleted', async () => {
    const caller = appRouter.createCaller({})
    await caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-08-01' })
    await caller.employees.delete({ id: empId })
    expect(await caller.followUps.listForEntity({ entityType: 'contact', entityId: empId })).toEqual([])
  })
})

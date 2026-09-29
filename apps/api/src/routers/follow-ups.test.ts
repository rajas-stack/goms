import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { contextForEmail } from '../testHelpers/authTestHelpers.js'

describe('followUps router', () => {
  let empId: string
  let orgNodeId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM follow_ups')
    // opportunities.department_id and commercial_boqs.department_id both FK
    // (RESTRICT) into hierarchy_nodes too — clear them first so this
    // doesn't conflict with rows left behind by opportunities.test.ts or
    // sales.test.ts (2026-08-26 hardening pass).
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    orgNodeId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: branch.id, stateCode: 27, name: 'Office' })).id
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

  describe('auth enforcement', () => {
    afterEach(() => {
      delete process.env.AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated caller when enforcement is off (existing behavior)', async () => {
      const caller = appRouter.createCaller({})
      await expect(
        caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-07-01' }),
      ).resolves.toBeDefined()
    })

    it('rejects an unauthenticated mutation once enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(
        caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-07-01' }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('still allows reads with no auth even when enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.followUps.listOpen()).resolves.toBeDefined()
    })

    it('allows the same mutation once enforcement is on, for a verified @amnex.com caller', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(
        caller.followUps.create({ entityType: 'contact', entityId: empId, dueDate: '2025-07-01' }),
      ).resolves.toBeDefined()
    })
  })

  describe('read protection (READ_AUTH_ENFORCEMENT_ENABLED)', () => {
    afterEach(() => {
      delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated read when the flag is unset (deliberate no-op default)', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.followUps.listOpen()).resolves.toBeDefined()
    })

    it('rejects an unauthenticated read once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.followUps.listOpen()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('rejects a non-Amnex identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@gmail.com'))
      await expect(caller.followUps.listOpen()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows a verified @amnex.com identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.followUps.listOpen()).resolves.toBeDefined()
    })
  })
})

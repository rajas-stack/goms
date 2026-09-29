import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { contextForEmail } from '../testHelpers/authTestHelpers.js'

describe('ownership router', () => {
  let deptId: string
  let branchId: string
  let empId: string
  let oppId: string
  let personA: string
  let personB: string

  beforeEach(async () => {
    await pool.query('DELETE FROM ownership_assignments')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunities')
    // commercial_boqs.department_id also FKs (RESTRICT) into hierarchy_nodes
    // — clear it first so this doesn't conflict with rows left behind by
    // sales.test.ts (2026-08-26 hardening pass).
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    await pool.query('DELETE FROM sales_postings')
    await pool.query('DELETE FROM sales_persons')
    const caller = appRouter.createCaller({})
    deptId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    branchId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: deptId, stateCode: 27, name: 'Branch' })).id
    empId = (await caller.employees.create({ name: 'Jane', designation: 'Officer', email: 'j@x.com', phone: '1', orgNodeId: branchId, managerId: null })).id
    oppId = (await caller.opportunities.create({ departmentId: deptId, opportunityName: 'Deal' })).id
    personA = (await caller.sales.create({ name: 'Alice', officialEmail: 'alice@amnex.com', designation: 'RM', tierKey: 'rm' })).id
    personB = (await caller.sales.create({ name: 'Bob', officialEmail: 'bob@amnex.com', designation: 'RM', tierKey: 'rm' })).id
  })

  it('assigns a direct owner and resolves it with source direct, depth 0', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    const res = await caller.ownership.resolveOwner({ entityType: 'orgNode', entityId: deptId, asOf: '2025-06-01' })
    expect(res).toMatchObject({ salesPersonId: personA, source: 'direct', depth: 0 })
  })

  it('resolves an org node with no direct owner from its nearest owned ancestor (inherited, depth 1)', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    const res = await caller.ownership.resolveOwner({ entityType: 'orgNode', entityId: branchId, asOf: '2025-06-01' })
    expect(res).toMatchObject({ salesPersonId: personA, source: 'inherited', viaEntityType: 'orgNode', viaEntityId: deptId, depth: 1 })
  })

  it('resolves a contact from its org node (cross-type fallback)', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    const res = await caller.ownership.resolveOwner({ entityType: 'contact', entityId: empId, asOf: '2025-06-01' })
    expect(res).toMatchObject({ salesPersonId: personA, source: 'inherited' })
  })

  it('resolves an opportunity from its department (cross-type fallback)', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    const res = await caller.ownership.resolveOwner({ entityType: 'opportunity', entityId: oppId, asOf: '2025-06-01' })
    expect(res).toMatchObject({ salesPersonId: personA, source: 'inherited' })
  })

  it('returns null when nothing up the chain owns the entity', async () => {
    const caller = appRouter.createCaller({})
    const res = await caller.ownership.resolveOwner({ entityType: 'orgNode', entityId: branchId, asOf: '2025-06-01' })
    expect(res).toBeNull()
  })

  it('resolveOwners batches multiple entities in one pass', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    const map = await caller.ownership.resolveOwners({ entityType: 'orgNode', entityIds: [deptId, branchId], asOf: '2025-06-01' })
    expect(map[deptId]).toMatchObject({ salesPersonId: personA, source: 'direct' })
    expect(map[branchId]).toMatchObject({ salesPersonId: personA, source: 'inherited' })
  })

  it('reassigning an owner closes the incumbent at the new start date (adjacent, no gap/overlap)', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personB, startDate: '2025-06-01' })
    const history = await caller.ownership.listFor({ entityType: 'orgNode', entityId: deptId })
    const a = history.find((h) => h.salesPersonId === personA)!
    expect(a.endDate).toBe('2025-06-01')
    const res = await caller.ownership.resolveOwner({ entityType: 'orgNode', entityId: deptId, asOf: '2025-05-31' })
    expect(res?.salesPersonId).toBe(personA)
    const res2 = await caller.ownership.resolveOwner({ entityType: 'orgNode', entityId: deptId, asOf: '2025-06-01' })
    expect(res2?.salesPersonId).toBe(personB)
  })

  it('rejects a replacement owner starting on or before the incumbent already-open assignment', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-06-01' })
    await expect(caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personB, startDate: '2025-06-01' }))
      .rejects.toThrow()
    await expect(caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personB, startDate: '2025-01-01' }))
      .rejects.toThrow()
  })

  it('requires an end date for a delegate role', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.ownership.assign({
      entityType: 'orgNode', entityId: deptId, salesPersonId: personA, role: 'delegate', startDate: '2025-01-01',
    })).rejects.toThrow()
    const ok = await caller.ownership.assign({
      entityType: 'orgNode', entityId: deptId, salesPersonId: personA, role: 'delegate',
      startDate: '2025-01-01', endDate: '2025-03-01',
    })
    expect(ok.role).toBe('delegate')
  })

  it('rejects an end date on or before the start date', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.ownership.assign({
      entityType: 'orgNode', entityId: deptId, salesPersonId: personA,
      startDate: '2025-01-01', endDate: '2025-01-01',
    })).rejects.toThrow()
  })

  it('rejects assigning an unknown entity type', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.ownership.assign({
      entityType: 'widget', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01',
    })).rejects.toThrow()
  })

  it('endOwnership closes an open assignment and rejects ending on/before its start', async () => {
    const caller = appRouter.createCaller({})
    const row = await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    await expect(caller.ownership.end({ id: row.id, endDate: '2025-01-01' })).rejects.toThrow()
    await caller.ownership.end({ id: row.id, endDate: '2025-06-01' })
    const res = await caller.ownership.resolveOwner({ entityType: 'orgNode', entityId: deptId, asOf: '2025-06-01' })
    expect(res).toBeNull()
  })

  it('transferBookOfBusiness moves only open owner rows that started before the effective date, tagging them with one shared batchId', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    await caller.ownership.assign({ entityType: 'opportunity', entityId: oppId, salesPersonId: personA, startDate: '2025-01-01' })
    // A future-dated assignment that hasn't started yet must be left alone.
    await caller.ownership.assign({ entityType: 'contact', entityId: empId, salesPersonId: personA, startDate: '2025-12-01' })

    const moved = await caller.ownership.transferBookOfBusiness({ fromSalesPersonId: personA, toSalesPersonId: personB, effectiveDate: '2025-06-01' })
    expect(moved).toHaveLength(2)
    expect(new Set(moved.map((m) => m.batchId)).size).toBe(1)

    const deptRes = await caller.ownership.resolveOwner({ entityType: 'orgNode', entityId: deptId, asOf: '2025-06-01' })
    expect(deptRes?.salesPersonId).toBe(personB)
    // empId's own contact-level assignment (personA, starting 2025-12-01)
    // hasn't started yet as of 2025-06-01, so it does NOT count as a direct
    // owner — but empId sits under branchId, a child of deptId, so it still
    // resolves an owner via the hierarchical/cross-type fallback chain: now
    // personB, since deptId's ownership already moved.
    const contactRes = await caller.ownership.resolveOwner({ entityType: 'contact', entityId: empId, asOf: '2025-06-01' })
    expect(contactRes).toMatchObject({ salesPersonId: personB, source: 'inherited' })
    // Once the future-dated assignment actually starts, the direct owner
    // check wins outright over the inherited chain.
    const stillA = await caller.ownership.resolveOwner({ entityType: 'contact', entityId: empId, asOf: '2025-12-01' })
    expect(stillA).toMatchObject({ salesPersonId: personA, source: 'direct' })
  })

  it('rejects transferring a book of business to the same person', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.ownership.transferBookOfBusiness({ fromSalesPersonId: personA, toSalesPersonId: personA, effectiveDate: '2025-06-01' }))
      .rejects.toThrow()
  })

  it('cascades ownership_assignments when the sales person is deleted', async () => {
    const caller = appRouter.createCaller({})
    await caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' })
    await caller.sales.delete({ id: personA })
    const history = await caller.ownership.listFor({ entityType: 'orgNode', entityId: deptId })
    expect(history).toEqual([])
  })

  // 2026-08-26 backend hardening pass.

  it('never leaves two simultaneously-open owners when two concurrent first-ever assigns race for the same entity', async () => {
    // The FOR UPDATE in `assign` only locks existing open-owner rows — for
    // an entity with no owner yet, there's nothing to lock, so without
    // ownership_assignments_one_open_owner_per_entity (the 2026-08-26
    // migration) both concurrent assigns could pass and both insert.
    const results = await Promise.allSettled([
      appRouter.createCaller({}).ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' }),
      appRouter.createCaller({}).ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personB, startDate: '2025-01-01' }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' })

    const caller = appRouter.createCaller({})
    const openOwners = (await caller.ownership.listFor({ entityType: 'orgNode', entityId: deptId }))
      .filter((a) => a.role === 'owner' && a.endDate === null)
    expect(openOwners).toHaveLength(1)
  })

  describe('auth enforcement', () => {
    afterEach(() => {
      delete process.env.AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated caller when enforcement is off (existing behavior)', async () => {
      const caller = appRouter.createCaller({})
      await expect(
        caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' }),
      ).resolves.toBeDefined()
    })

    it('rejects an unauthenticated mutation once enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(
        caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('still allows reads with no auth even when enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.ownership.listAssignments()).resolves.toBeDefined()
    })

    it('allows the same mutation once enforcement is on, for a verified @amnex.com caller', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(
        caller.ownership.assign({ entityType: 'orgNode', entityId: deptId, salesPersonId: personA, startDate: '2025-01-01' }),
      ).resolves.toBeDefined()
    })
  })

  describe('read protection (READ_AUTH_ENFORCEMENT_ENABLED)', () => {
    afterEach(() => {
      delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated read when the flag is unset (deliberate no-op default)', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.ownership.listAssignments()).resolves.toBeDefined()
    })

    it('rejects an unauthenticated read once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.ownership.listAssignments()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('rejects a non-Amnex identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@gmail.com'))
      await expect(caller.ownership.listAssignments()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows a verified @amnex.com identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.ownership.listAssignments()).resolves.toBeDefined()
    })
  })
})

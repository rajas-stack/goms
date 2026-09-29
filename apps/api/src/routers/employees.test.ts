import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { contextForEmail } from '../testHelpers/authTestHelpers.js'

describe('employees router', () => {
  let orgNodeId: string
  let otherOrgNodeId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM employee_merge_audit')
    await pool.query('DELETE FROM transfers')
    await pool.query('DELETE FROM timeline_events')
    await pool.query('DELETE FROM employee_charges')
    // opportunities.department_id and commercial_boqs.department_id both FK
    // (RESTRICT) into hierarchy_nodes too — clear them first so this
    // doesn't conflict with rows left behind by opportunities.test.ts/
    // ownership.test.ts/search.test.ts (Phase 7) or sales.test.ts
    // (2026-08-26 hardening pass).
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
    // office nests under a branch, not directly under a department — see
    // packages/domain's NODE_TYPE_MAP (department.childKeys=['branch','department']).
    const branch = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    orgNodeId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: branch.id, stateCode: 27, name: 'Office A' })).id
    otherOrgNodeId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: branch.id, stateCode: 27, name: 'Office B' })).id
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

  it('adds a timeline event with agenda/outcome/nextSteps and round-trips them', async () => {
    const caller = appRouter.createCaller({})
    const emp = await makeEmployee()
    const created = await caller.employees.timeline.add({
      employeeId: emp.id, type: 'meeting', title: 'Budget review', date: '2026-01-01',
      agenda: 'Discuss Q1 budget', outcome: 'Approved with revisions', nextSteps: 'Send revised sheet by Friday',
    })
    expect(created.agenda).toBe('Discuss Q1 budget')
    expect(created.outcome).toBe('Approved with revisions')
    expect(created.nextSteps).toBe('Send revised sheet by Friday')
    const timeline = await caller.employees.timeline.listForEmployee({ employeeId: emp.id })
    const fetched = timeline.find((t) => t.id === created.id)
    expect(fetched?.agenda).toBe('Discuss Q1 budget')
    expect(fetched?.outcome).toBe('Approved with revisions')
    expect(fetched?.nextSteps).toBe('Send revised sheet by Friday')
  })

  it('adds a timeline event without agenda/outcome/nextSteps (still optional)', async () => {
    const caller = appRouter.createCaller({})
    const emp = await makeEmployee()
    const created = await caller.employees.timeline.add({
      employeeId: emp.id, type: 'call', title: 'Quick call', date: '2026-01-02',
    })
    expect(created.agenda).toBeUndefined()
    expect(created.outcome).toBeUndefined()
    expect(created.nextSteps).toBeUndefined()
  })

  // Task 8.4 (Item 14): editing a timeline entry must mutate the same row —
  // no new record — and support every field, including clearing a
  // previously-set agenda/outcome/nextSteps back out and upgrading a legacy
  // plain-string attendee to the new {salesPersonId, name} shape.
  describe('timeline.update', () => {
    it('updates fields on the same record (same id, no new row)', async () => {
      const caller = appRouter.createCaller({})
      const emp = await makeEmployee()
      const created = await caller.employees.timeline.add({
        employeeId: emp.id, type: 'call', title: 'Quick call', date: '2026-01-02',
      })
      const updated = await caller.employees.timeline.update({
        id: created.id,
        patch: {
          title: 'Rescheduled call', date: '2026-01-03', time: '14:30', note: 'Moved to afternoon',
          agenda: 'Discuss renewal', outcome: 'Agreed to renew', nextSteps: 'Send contract',
          attendees: [{ salesPersonId: 'sp-1', name: 'Asha Rao' }],
        },
      })
      expect(updated.id).toBe(created.id)
      expect(updated.title).toBe('Rescheduled call')
      expect(updated.date).toBe('2026-01-03')
      expect(updated.time).toBe('14:30')
      expect(updated.note).toBe('Moved to afternoon')
      expect(updated.agenda).toBe('Discuss renewal')
      expect(updated.outcome).toBe('Agreed to renew')
      expect(updated.nextSteps).toBe('Send contract')
      expect(updated.attendees).toEqual([{ salesPersonId: 'sp-1', name: 'Asha Rao' }])

      // The employee also carries its own "joined" event from creation —
      // asserting the edited entry's own id/title/count within the full list
      // (rather than the list length) confirms the edit updated in place
      // without adding a second row for it.
      const timeline = await caller.employees.timeline.listForEmployee({ employeeId: emp.id })
      expect(timeline.filter((t) => t.id === created.id)).toHaveLength(1)
      expect(timeline.filter((t) => t.title === 'Rescheduled call')).toHaveLength(1)
    })

    it('clears a previously-set agenda/outcome/nextSteps when the patch sends null', async () => {
      const caller = appRouter.createCaller({})
      const emp = await makeEmployee()
      const created = await caller.employees.timeline.add({
        employeeId: emp.id, type: 'meeting', title: 'Budget review', date: '2026-01-01',
        agenda: 'Discuss Q1 budget', outcome: 'Approved with revisions', nextSteps: 'Send revised sheet by Friday',
      })
      const updated = await caller.employees.timeline.update({
        id: created.id,
        patch: { agenda: null, outcome: null, nextSteps: null },
      })
      expect(updated.agenda).toBeUndefined()
      expect(updated.outcome).toBeUndefined()
      expect(updated.nextSteps).toBeUndefined()
    })

    it('leaves legacy plain-string attendees intact when the patch does not touch attendees', async () => {
      const caller = appRouter.createCaller({})
      const emp = await makeEmployee()
      const created = await caller.employees.timeline.add({
        employeeId: emp.id, type: 'meeting', title: 'Budget review', date: '2026-01-01',
        attendees: ['Legacy Person'],
      })
      const updated = await caller.employees.timeline.update({ id: created.id, patch: { title: 'Budget review v2' } })
      expect(updated.title).toBe('Budget review v2')
      expect(updated.attendees).toEqual(['Legacy Person'])
    })

    it('upgrades a legacy plain-string attendee to the new {salesPersonId, name} shape when re-picked', async () => {
      const caller = appRouter.createCaller({})
      const emp = await makeEmployee()
      const created = await caller.employees.timeline.add({
        employeeId: emp.id, type: 'meeting', title: 'Budget review', date: '2026-01-01',
        attendees: ['Legacy Person'],
      })
      const updated = await caller.employees.timeline.update({
        id: created.id,
        patch: { attendees: [{ salesPersonId: 'sp-1', name: 'Asha Rao' }] },
      })
      expect(updated.attendees).toEqual([{ salesPersonId: 'sp-1', name: 'Asha Rao' }])
    })
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

  // 2026-08-26 backend hardening pass.

  it('never creates a reporting cycle when two setManager calls point two employees at each other concurrently', async () => {
    const caller = appRouter.createCaller({})
    const x = await makeEmployee({ name: 'X' })
    const y = await makeEmployee({ name: 'Y' })

    const results = await Promise.allSettled([
      caller.employees.setManager({ employeeId: x.id, managerId: y.id }),
      caller.employees.setManager({ employeeId: y.id, managerId: x.id }),
    ])
    const fulfilledCount = results.filter((r) => r.status === 'fulfilled').length
    expect(fulfilledCount).toBeLessThanOrEqual(1)

    const finalX = await caller.employees.get({ id: x.id })
    const finalY = await caller.employees.get({ id: y.id })
    expect(finalX!.managerId === y.id && finalY!.managerId === x.id).toBe(false)
  })

  it('clears a dangling deptHead pointer on a hierarchy node when the department head is deleted', async () => {
    const caller = appRouter.createCaller({})
    const dept = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept With Head' })
    const head = await makeEmployee({ name: 'Head', orgNodeId: dept.id })
    await caller.hierarchy.updateNode({ id: dept.id, patch: { metadata: { deptHead: head.id } } })
    expect((await caller.hierarchy.getNode({ id: dept.id }))?.metadata?.deptHead).toBe(head.id)

    await caller.employees.delete({ id: head.id })

    expect((await caller.hierarchy.getNode({ id: dept.id }))?.metadata?.deptHead).toBeUndefined()
  })

  describe('auth enforcement', () => {
    afterEach(() => {
      delete process.env.AUTH_ENFORCEMENT_ENABLED
    })

    // Top-level mutation: employees.create
    it('still allows employees.create with no auth when enforcement is off (existing behavior)', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.employees.create({
        name: 'Jane Doe', designation: 'Officer', email: 'jane@example.com', phone: '9999999999',
        orgNodeId, managerId: null,
      })).resolves.toBeDefined()
    })

    it('rejects an unauthenticated employees.create once enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.employees.create({
        name: 'Jane Doe', designation: 'Officer', email: 'jane@example.com', phone: '9999999999',
        orgNodeId, managerId: null,
      })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('allows employees.create once enforcement is on, for a verified @amnex.com caller', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.employees.create({
        name: 'Jane Doe', designation: 'Officer', email: 'jane@example.com', phone: '9999999999',
        orgNodeId, managerId: null,
      })).resolves.toBeDefined()
    })

    // Nested sub-router mutation: employees.timeline.add
    it('still allows timeline.add with no auth when enforcement is off (existing behavior)', async () => {
      const caller = appRouter.createCaller({})
      const emp = await makeEmployee()
      await expect(caller.employees.timeline.add({
        employeeId: emp.id, type: 'call', title: 'Quick call', date: '2026-01-02',
      })).resolves.toBeDefined()
    })

    it('rejects an unauthenticated timeline.add once enforcement is on', async () => {
      const emp = await makeEmployee()
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.employees.timeline.add({
        employeeId: emp.id, type: 'call', title: 'Quick call', date: '2026-01-02',
      })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('allows timeline.add once enforcement is on, for a verified @amnex.com caller', async () => {
      const emp = await makeEmployee()
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.employees.timeline.add({
        employeeId: emp.id, type: 'call', title: 'Quick call', date: '2026-01-02',
      })).resolves.toBeDefined()
    })

    // Nested sub-router mutation: employees.transfers.transfer
    it('still allows transfers.transfer with no auth when enforcement is off (existing behavior)', async () => {
      const caller = appRouter.createCaller({})
      const emp = await makeEmployee({ designation: 'Officer' })
      await expect(caller.employees.transfers.transfer({
        employeeId: emp.id, toOrgNodeId: otherOrgNodeId, toDesignation: 'Senior Officer',
        effectiveDate: '2026-02-01', reason: 'Promotion',
      })).resolves.toBeDefined()
    })

    it('rejects an unauthenticated transfers.transfer once enforcement is on', async () => {
      const emp = await makeEmployee({ designation: 'Officer' })
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.employees.transfers.transfer({
        employeeId: emp.id, toOrgNodeId: otherOrgNodeId, toDesignation: 'Senior Officer',
        effectiveDate: '2026-02-01', reason: 'Promotion',
      })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('allows transfers.transfer once enforcement is on, for a verified @amnex.com caller', async () => {
      const emp = await makeEmployee({ designation: 'Officer' })
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.employees.transfers.transfer({
        employeeId: emp.id, toOrgNodeId: otherOrgNodeId, toDesignation: 'Senior Officer',
        effectiveDate: '2026-02-01', reason: 'Promotion',
      })).resolves.toBeDefined()
    })

    // Query stays open under enforcement
    it('still allows reads (listAll) with no auth even when enforcement is on', async () => {
      process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.employees.listAll()).resolves.toBeDefined()
    })
  })

  describe('read protection (READ_AUTH_ENFORCEMENT_ENABLED)', () => {
    afterEach(() => {
      delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated read when the flag is unset (deliberate no-op default)', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.employees.listAll()).resolves.toBeDefined()
    })

    it('rejects an unauthenticated read once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.employees.listAll()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('rejects a non-Amnex identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@gmail.com'))
      await expect(caller.employees.listAll()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows a verified @amnex.com identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.employees.listAll()).resolves.toBeDefined()
    })
  })
})

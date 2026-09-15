import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { contextForEmail } from '../testHelpers/authTestHelpers.js'

describe('search router', () => {
  let stateId: string
  let deptId: string
  let officeId: string
  let managerId: string
  let empId: string
  let vacantId: string
  let transferredId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM ownership_assignments')
    await pool.query('DELETE FROM follow_ups')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    // commercial_boqs.department_id also FKs (RESTRICT) into hierarchy_nodes
    // — clear it first so this doesn't conflict with rows left behind by
    // sales.test.ts (2026-08-26 hardening pass).
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM transfers')
    await pool.query('DELETE FROM timeline_events')
    await pool.query('DELETE FROM employee_charges')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    await pool.query('DELETE FROM sales_postings')
    await pool.query('DELETE FROM sales_persons')

    const caller = appRouter.createCaller({})
    stateId = (await caller.hierarchy.createNode({ domain: 'geo', typeKey: 'state', parentId: null, stateCode: 24, name: 'Gujarat' })).id
    deptId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 24, name: 'Revenue Department' })).id
    const branchId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: deptId, stateCode: 24, name: 'Branch' })).id
    officeId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'office', parentId: branchId, stateCode: 24, name: 'Ahmedabad Office' })).id

    managerId = (await caller.employees.create({
      name: 'Priya Manager', designation: 'Collector', email: 'p@x.com', phone: '1', orgNodeId: officeId, managerId: null,
    })).id
    empId = (await caller.employees.create({
      name: 'Rahul Officer', designation: 'Officer', email: 'r@x.com', phone: '2', orgNodeId: officeId, managerId,
      connected: true, importantContact: true, followUpDate: '2025-06-15',
    })).id
    vacantId = (await caller.employees.create({
      name: 'Vacant Slot', designation: 'Clerk', email: '', phone: '', orgNodeId: officeId, managerId: null, vacant: true,
    })).id
    transferredId = (await caller.employees.create({
      name: 'Moved Officer', designation: 'Officer', email: 'm@x.com', phone: '3', orgNodeId: officeId, managerId: null,
    })).id
    await caller.employees.transfers.transfer({
      employeeId: transferredId, toOrgNodeId: officeId, toDesignation: 'Senior Officer',
      effectiveDate: '2025-01-01', reason: 'promotion',
    })
  })

  it('matches the department category by name', async () => {
    const caller = appRouter.createCaller({})
    const results = await caller.search.search({ query: 'revenue' })
    expect(results.some((r) => r.category === 'department' && r.id === deptId)).toBe(true)
  })

  it('matches the employee category by name', async () => {
    const caller = appRouter.createCaller({})
    const results = await caller.search.search({ query: 'rahul' })
    expect(results.some((r) => r.category === 'employee' && r.id === empId)).toBe(true)
  })

  it('matches the geography category by state name and scopes a state-name query', async () => {
    const caller = appRouter.createCaller({})
    const results = await caller.search.search({ query: 'gujarat' })
    expect(results.some((r) => r.category === 'geography' && r.id === stateId)).toBe(true)
  })

  it('"connected" intent excludes vacant positions and a person marked not connected', async () => {
    const caller = appRouter.createCaller({})
    const notConnectedId = (await caller.employees.create({
      name: 'Distant Contact', designation: 'Officer', email: 'd@x.com', phone: '4',
      orgNodeId: officeId, managerId: null, connected: false,
    })).id
    const results = await caller.search.search({ query: 'connected' })
    const ids = results.map((r) => r.id)
    expect(ids).toContain(empId)
    expect(ids).not.toContain(vacantId)
    expect(ids).not.toContain(notConnectedId)
  })

  it('"vacant" intent returns only vacant positions', async () => {
    const caller = appRouter.createCaller({})
    const results = await caller.search.search({ query: 'vacant' })
    expect(results.map((r) => r.id)).toEqual([vacantId])
    expect(results[0].title).toContain('Vacant')
  })

  it('"transferred" intent returns only employees with a transfer record', async () => {
    const caller = appRouter.createCaller({})
    const results = await caller.search.search({ query: 'transferred' })
    expect(results.map((r) => r.id)).toEqual([transferredId])
  })

  it('"high priority" intent returns only importantContact employees', async () => {
    const caller = appRouter.createCaller({})
    const results = await caller.search.search({ query: 'high priority' })
    expect(results.map((r) => r.id)).toEqual([empId])
  })

  it('"follow ups today" matches only an exact today due date; "follow ups due" also matches overdue', async () => {
    const caller = appRouter.createCaller({})
    const today = new Date().toISOString().slice(0, 10)
    const dueTodayId = (await caller.employees.create({
      name: 'Due Today', designation: 'Officer', email: 't@x.com', phone: '5',
      orgNodeId: officeId, managerId: null, followUpDate: today,
    })).id
    const overdueId = (await caller.employees.create({
      name: 'Overdue Contact', designation: 'Officer', email: 'o@x.com', phone: '6',
      orgNodeId: officeId, managerId: null, followUpDate: '2001-01-01',
    })).id
    const notDueId = (await caller.employees.create({
      name: 'Future Contact', designation: 'Officer', email: 'f@x.com', phone: '7',
      orgNodeId: officeId, managerId: null, followUpDate: '2099-01-01',
    })).id

    const todayResults = await caller.search.search({ query: 'follow ups today' })
    expect(todayResults.map((r) => r.id)).toEqual([dueTodayId])

    const dueResults = await caller.search.search({ query: 'follow ups due' })
    const dueIds = dueResults.map((r) => r.id)
    expect(dueIds).toContain(dueTodayId)
    expect(dueIds).toContain(overdueId)
    expect(dueIds).not.toContain(notDueId)
  })

  it('"reports to <manager>" returns that manager\'s direct reports', async () => {
    const caller = appRouter.createCaller({})
    const results = await caller.search.search({ query: 'reports to priya' })
    expect(results.map((r) => r.id)).toEqual([empId])
  })

  it('"under <container>" returns the container plus employees in its subtree', async () => {
    const caller = appRouter.createCaller({})
    const results = await caller.search.search({ query: 'under revenue department' })
    expect(results[0]).toMatchObject({ id: deptId, note: 'Container' })
    expect(results.some((r) => r.id === empId)).toBe(true)
  })

  it('matches the work (opportunity) category and returns its department via relatedRecords', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId: deptId, opportunityName: 'Smart City Tender', vertical: 'Smart Cities' })
    const results = await caller.search.search({ query: 'smart city' })
    const hit = results.find((r) => r.category === 'work')
    expect(hit?.id).toBe(opp.id)
    const related = await caller.search.relatedRecords(hit!)
    expect(related.some((r) => r.category === 'department' && r.id === deptId)).toBe(true)
  })

  it('matches the salesPerson category by name', async () => {
    const caller = appRouter.createCaller({})
    const person = await caller.sales.create({ name: 'Sunita Sales', officialEmail: 'sunita@amnex.com', designation: 'RM', tierKey: 'rm' })
    const results = await caller.search.search({ query: 'sunita' })
    expect(results.some((r) => r.category === 'salesPerson' && r.id === person.id)).toBe(true)
  })

  it('relatedRecords for an employee surfaces their department and manager', async () => {
    const caller = appRouter.createCaller({})
    const related = await caller.search.relatedRecords({
      kind: 'employee', category: 'employee', id: empId, title: 'Rahul Officer', subtitle: 'Officer',
      code: null, domain: null, stateCode: 24,
    })
    expect(related.some((r) => r.category === 'department' && r.id === deptId)).toBe(true)
    expect(related.some((r) => r.category === 'employee' && r.id === managerId)).toBe(true)
  })

  it('relationshipAnalytics counts vacant/connected/highPriority/transfers correctly', async () => {
    const caller = appRouter.createCaller({})
    const stats = await caller.search.relationshipAnalytics()
    expect(stats.vacant).toBe(1)
    expect(stats.transfers).toBe(1)
    expect(stats.highPriority).toBe(1)
    expect(stats.total).toBe(3) // managerId, empId, transferredId (vacant excluded from "people")
  })

  describe('read protection (READ_AUTH_ENFORCEMENT_ENABLED)', () => {
    afterEach(() => {
      delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
    })

    it('still allows an unauthenticated search when the flag is unset (deliberate no-op default)', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.search.search({ query: 'a' })).resolves.toBeDefined()
    })

    it('rejects an unauthenticated search once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller({})
      await expect(caller.search.search({ query: 'a' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('rejects a non-Amnex identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@gmail.com'))
      await expect(caller.search.search({ query: 'a' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows a verified @amnex.com identity once the flag is on', async () => {
      process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
      const caller = appRouter.createCaller(contextForEmail('someone@amnex.com'))
      await expect(caller.search.search({ query: 'a' })).resolves.toBeDefined()
    })
  })
})

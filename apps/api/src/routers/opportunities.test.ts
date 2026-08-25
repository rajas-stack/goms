import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('opportunities router', () => {
  let departmentId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    // Other test files (sharing this DB, fileParallelism off) may leave
    // employee rows behind, which would otherwise block deleting
    // hierarchy_nodes below via employees.org_node_id's RESTRICT FK.
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    departmentId = (await caller.hierarchy.createNode({
      domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept',
    })).id
  })

  it('creates an opportunity defaulting to the pipeline stage and logs an opening stage change', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'GEM tender A' })
    expect(opp.stageKey).toBe('pipeline')
    expect(opp.closedOn).toBeNull()
    expect(opp.stateCode).toBe(27)
    expect(opp.currency).toBe('INR')
    expect(opp.valueUnit).toBe('lakh')
    const changes = await caller.opportunities.listStageChanges({ opportunityId: opp.id })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ fromStageKey: null, toStageKey: 'pipeline', note: 'Opportunity created' })
  })

  it('lists newest-created first, tie-broken by name', async () => {
    const caller = appRouter.createCaller({})
    await caller.opportunities.create({ departmentId, opportunityName: 'Zebra' })
    await caller.opportunities.create({ departmentId, opportunityName: 'Alpha' })
    const list = await caller.opportunities.list()
    // Both created "today" so createdAt ties — tie-break is name, descending
    // per the in-memory sort (`b.createdAt.localeCompare(a.createdAt) ||
    // a.opportunityName.localeCompare(b.opportunityName)`).
    expect(list.map((o) => o.opportunityName)).toEqual(['Alpha', 'Zebra'])
  })

  it('logs a stage change and derives closedOn when the stage moves to a closed stage, and clears it moving back to open', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Deal' })
    const won = await caller.opportunities.update({ id: opp.id, patch: { stageKey: 'won' } })
    expect(won.closedOn).not.toBeNull()
    const changes = await caller.opportunities.listStageChanges({ opportunityId: opp.id })
    expect(changes.map((c) => c.toStageKey)).toEqual(['pipeline', 'won'])

    const reopened = await caller.opportunities.update({ id: opp.id, patch: { stageKey: 'qualified' } })
    expect(reopened.closedOn).toBeNull()
  })

  it('does not log a stage change or touch closedOn for a non-stage patch', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Deal' })
    await caller.opportunities.update({ id: opp.id, patch: { vertical: 'Smart Cities' } })
    const changes = await caller.opportunities.listStageChanges({ opportunityId: opp.id })
    expect(changes).toHaveLength(1) // only the opening row
    const updated = await caller.opportunities.get({ id: opp.id })
    expect(updated?.vertical).toBe('Smart Cities')
    expect(updated?.closedOn).toBeNull()
  })

  it('cascades stage changes when an opportunity is deleted', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Deal' })
    await caller.opportunities.delete({ id: opp.id })
    expect(await caller.opportunities.get({ id: opp.id })).toBeNull()
    expect(await caller.opportunities.listStageChanges({ opportunityId: opp.id })).toEqual([])
  })

  it('cascades opportunities (and their stage changes) when the owning department node is deleted', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Deal' })
    await caller.hierarchy.deleteNode({ id: departmentId })
    expect(await caller.opportunities.get({ id: opp.id })).toBeNull()
    expect(await caller.opportunities.listStageChanges({ opportunityId: opp.id })).toEqual([])
  })

  it('scopes listByDepartment to one department, name-sorted', async () => {
    const caller = appRouter.createCaller({})
    const otherDept = (await caller.hierarchy.createNode({
      domain: 'org', typeKey: 'department', parentId: null, stateCode: 9, name: 'Other Dept',
    })).id
    await caller.opportunities.create({ departmentId, opportunityName: 'B' })
    await caller.opportunities.create({ departmentId, opportunityName: 'A' })
    await caller.opportunities.create({ departmentId: otherDept, opportunityName: 'C' })
    const list = await caller.opportunities.listByDepartment({ departmentId })
    expect(list.map((o) => o.opportunityName)).toEqual(['A', 'B'])
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { DEPARTMENT_REQUIRED_MESSAGE } from '@goms/domain'

// The Create Bid rule: a bid is only created for an opportunity that has a department,
// and the department lives on the OPPORTUNITY. These run against the real router + real
// Postgres, including the "hierarchy insert succeeds, bid insert fails" rollback.
describe('bids.create — resolving the opportunity department', () => {
  const caller = () => appRouter.createCaller({})
  let meity: { id: string; stateCode: number | null }

  const nodes = async () => (await pool.query(`SELECT * FROM hierarchy_nodes WHERE domain='org' ORDER BY name`)).rows
  const oppRow = async (id: string) => (await pool.query('SELECT department_id, state_code FROM opportunities WHERE id=$1', [id])).rows[0]
  const bidCount = async () => Number((await pool.query('SELECT count(*) n FROM bids')).rows[0].n)
  /** An opportunity with no department yet (legal since the department-optional migration). */
  async function orphanOpportunity(name = 'AI Solution') {
    const dept = (await caller().hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 0, name: `Holder ${name}` })).id
    const opp = await caller().opportunities.create({ departmentId: dept, opportunityName: name, submissionDate: '2026-10-10' })
    await pool.query('UPDATE opportunities SET department_id=NULL, state_code=NULL WHERE id=$1', [opp.id])
    await pool.query('DELETE FROM hierarchy_nodes WHERE id=$1', [dept])
    return opp.id as string
  }

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    await pool.query(`DELETE FROM commercial_audit_logs WHERE entity_type='opportunity'`)
    const m = await caller().hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 0, name: 'MeitY' })
    meity = { id: m.id, stateCode: m.stateCode }
  })

  it('opportunity that already has a department: the bid is created and the department is used as is', async () => {
    const opp = await caller().opportunities.create({ departmentId: meity.id, opportunityName: 'Has dept' })
    const bid = await caller().bids.create({ opportunityId: opp.id })
    expect(bid.opportunityId).toBe(opp.id)
    expect((await oppRow(opp.id)).department_id).toBe(meity.id)
  })

  it('does not let a department choice silently replace one the opportunity already has', async () => {
    const opp = await caller().opportunities.create({ departmentId: meity.id, opportunityName: 'Has dept' })
    const other = await caller().hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 0, name: 'Other' })
    await expect(caller().bids.create({ opportunityId: opp.id, department: { mode: 'existing', departmentId: other.id } }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await oppRow(opp.id)).department_id).toBe(meity.id)
    expect(await bidCount()).toBe(0)
  })

  it('refuses a bid for an opportunity with no department and no choice — nothing is written', async () => {
    const opp = await orphanOpportunity()
    await expect(caller().bids.create({ opportunityId: opp })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: DEPARTMENT_REQUIRED_MESSAGE })
    expect(await bidCount()).toBe(0)
    expect((await oppRow(opp)).department_id).toBeNull()
  })

  it('no department → choose an existing one: the opportunity is assigned, the bid created, and it is audited', async () => {
    const opp = await orphanOpportunity()
    const bid = await caller().bids.create({ opportunityId: opp, department: { mode: 'existing', departmentId: meity.id } })
    expect(bid.opportunityId).toBe(opp)
    expect(await oppRow(opp)).toMatchObject({ department_id: meity.id, state_code: 0 })
    const audit = (await pool.query(`SELECT field, new_value FROM commercial_audit_logs WHERE entity_type='opportunity' AND entity_id=$1`, [opp])).rows
    expect(audit).toEqual([{ field: 'departmentId', new_value: meity.id }])
  })

  it('no department → create India AI under the existing MeitY: child department created, assigned, bid created', async () => {
    const opp = await orphanOpportunity()
    await caller().bids.create({
      opportunityId: opp,
      department: { mode: 'create', name: 'India AI', parent: { mode: 'existing', departmentId: meity.id } },
    })
    const indiaAi = (await nodes()).find((n) => n.name === 'India AI')!
    expect(indiaAi).toMatchObject({ type_key: 'department', parent_id: meity.id, state_code: 0, status: 'active' })
    expect((await oppRow(opp)).department_id).toBe(indiaAi.id)
    expect(await bidCount()).toBe(1)
  })

  it('no department → create both MeitY (new major department) and India AI: both created through the hierarchy, then assigned', async () => {
    await pool.query('DELETE FROM hierarchy_nodes')
    const opp = await orphanOpportunity()
    await caller().bids.create({
      opportunityId: opp,
      department: { mode: 'create', name: 'India AI', parent: { mode: 'create', name: 'MeitY', stateCode: 0 } },
    })
    const all = await nodes()
    const major = all.find((n) => n.name === 'MeitY')!
    const child = all.find((n) => n.name === 'India AI')!
    expect(major).toMatchObject({ type_key: 'department', parent_id: null, state_code: 0 })
    expect(child).toMatchObject({ type_key: 'department', parent_id: major.id, state_code: 0 })
    expect((await oppRow(opp)).department_id).toBe(child.id)
  })

  it('re-uses a department that already exists instead of duplicating it (case-insensitive)', async () => {
    const first = await orphanOpportunity('One')
    const second = await orphanOpportunity('Two')
    const choice = { mode: 'create' as const, name: 'India AI', parent: { mode: 'existing' as const, departmentId: meity.id } }
    await caller().bids.create({ opportunityId: first, department: choice })
    await caller().bids.create({ opportunityId: second, department: { ...choice, name: 'india ai ' } })
    expect((await nodes()).filter((n) => n.name.toLowerCase().trim() === 'india ai')).toHaveLength(1)
    expect((await oppRow(first)).department_id).toBe((await oppRow(second)).department_id)
  })

  it('still rejects a second bid for the same opportunity', async () => {
    const opp = await caller().opportunities.create({ departmentId: meity.id, opportunityName: 'Dup' })
    await caller().bids.create({ opportunityId: opp.id })
    await expect(caller().bids.create({ opportunityId: opp.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await bidCount()).toBe(1)
  })

  it('an unusable department creates nothing: no bid, no assignment, no new nodes', async () => {
    const opp = await orphanOpportunity()
    const before = (await nodes()).length
    const missing = '00000000-0000-4000-8000-000000000000'
    await expect(caller().bids.create({ opportunityId: opp, department: { mode: 'existing', departmentId: missing } }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().bids.create({ opportunityId: opp, department: { mode: 'create', name: 'X', parent: { mode: 'existing', departmentId: missing } } }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await bidCount()).toBe(0)
    expect((await oppRow(opp)).department_id).toBeNull()
    expect((await nodes()).length).toBe(before)
  })

  it('only an org department can be chosen — not another kind of node', async () => {
    const opp = await orphanOpportunity()
    const branch = await caller().hierarchy.createNode({ domain: 'org', typeKey: 'branch', parentId: meity.id, stateCode: 0, name: 'A Branch' })
    await expect(caller().bids.create({ opportunityId: opp, department: { mode: 'existing', departmentId: branch.id } }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await oppRow(opp)).department_id).toBeNull()
  })

  it('rolls EVERYTHING back if the bid itself then fails: the new hierarchy and the assignment do not survive', async () => {
    const opp = await orphanOpportunity()
    // Force the bid insert to fail after the hierarchy work has already happened:
    // a bid row exists for this opportunity (inserted behind the router's back).
    await pool.query(`INSERT INTO bids (opportunity_id, bid_code) VALUES ($1, 'BID-2099-0001')`, [opp])
    const before = (await nodes()).length
    await expect(caller().bids.create({
      opportunityId: opp,
      department: { mode: 'create', name: 'India AI', parent: { mode: 'create', name: 'Brand New Ministry', stateCode: 0 } },
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await nodes()).length).toBe(before)
    expect((await nodes()).some((n) => n.name === 'India AI' || n.name === 'Brand New Ministry')).toBe(false)
    expect((await oppRow(opp)).department_id).toBeNull()
  })

  it('validates names', async () => {
    const opp = await orphanOpportunity()
    await expect(caller().bids.create({
      opportunityId: opp, department: { mode: 'create', name: '   ', parent: { mode: 'existing', departmentId: meity.id } },
    })).rejects.toBeTruthy()
    expect(await bidCount()).toBe(0)
  })
})

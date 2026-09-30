import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('bids router', () => {
  let departmentId: string
  let opportunityId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    departmentId = (await caller.hierarchy.createNode({
      domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept',
    })).id
    opportunityId = (await caller.opportunities.create({
      departmentId, opportunityName: 'AI Document Processing System', submissionDate: '2026-10-10',
    })).id
  })

  it('creates a bid with an allocated bid code, defaulting to the solutioning stage', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    expect(bid.bidCode).toMatch(/^BID-\d{4}-\d{4}$/)
    expect(bid.stageKey).toBe('solutioning')
    expect(bid.decision).toBe('pending')
    expect(bid.status).toBe('active')
    expect(bid.dataConfidence).toBe('verified')
  })

  it('allocates sequential bid codes within the same year', async () => {
    const caller = appRouter.createCaller({})
    const opp2 = await caller.opportunities.create({ departmentId, opportunityName: 'Second tender' })
    const bid1 = await caller.bids.create({ opportunityId })
    const bid2 = await caller.bids.create({ opportunityId: opp2.id })
    const seq1 = Number(bid1.bidCode.split('-')[2])
    const seq2 = Number(bid2.bidCode.split('-')[2])
    expect(seq2).toBe(seq1 + 1)
  })

  it('rejects a second bid for the same opportunity', async () => {
    const caller = appRouter.createCaller({})
    await caller.bids.create({ opportunityId })
    await expect(caller.bids.create({ opportunityId })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('seeds a submissionDeadline milestone from the opportunity\'s current submission date when parseable', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const milestones = await caller.bidMilestones.listForBid({ bidId: bid.id })
    const deadline = milestones.find((m) => m.key === 'submissionDeadline')
    expect(deadline).toBeDefined()
    expect(deadline!.dueAt).not.toBeNull()
  })

  it('seeds a null-due submissionDeadline milestone when the opportunity submission date is unparseable', async () => {
    const caller = appRouter.createCaller({})
    const opp = await caller.opportunities.create({ departmentId, opportunityName: 'Garbage date tender', submissionDate: '10-10-2026 14:00 Hrs' })
    const bid = await caller.bids.create({ opportunityId: opp.id })
    const milestones = await caller.bidMilestones.listForBid({ bidId: bid.id })
    const deadline = milestones.find((m) => m.key === 'submissionDeadline')
    expect(deadline).toBeDefined()
    expect(deadline!.dueAt).toBeNull()
  })

  it('gets a bid by id, and returns null for an unknown id', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    expect((await caller.bids.get({ id: bid.id }))?.id).toBe(bid.id)
    expect(await caller.bids.get({ id: '00000000-0000-0000-0000-000000000099' })).toBeNull()
  })

  it('listForGrid joins in the opportunity\'s tender ID and department', async () => {
    const caller = appRouter.createCaller({})
    await caller.bids.create({ opportunityId })
    const grid = await caller.bids.listForGrid({})
    expect(grid).toHaveLength(1)
    expect(grid[0]).toMatchObject({ opportunityId, departmentId, opportunityName: 'AI Document Processing System' })
  })

  it('rejects decision=go before the bid reaches submitted', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await expect(caller.bids.update({ id: bid.id, patch: { decision: 'go' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('allows decision=go and stageKey=submitted in the same patch', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const updated = await caller.bids.update({ id: bid.id, patch: { stageKey: 'submitted', decision: 'go' } })
    expect(updated.stageKey).toBe('goApproved')
    expect(updated.decision).toBe('go')
  })

  it('never gates decision=no_go, even from the initial stage', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const updated = await caller.bids.update({ id: bid.id, patch: { decision: 'no_go' } })
    expect(updated.stageKey).toBe('dropped')
    expect(updated.decision).toBe('no_go')
  })

  it('syncs the opportunity to submitted when the bid stage reaches submitted, and no further if already past it', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.bids.update({ id: bid.id, patch: { stageKey: 'submitted' } })
    expect((await caller.opportunities.get({ id: opportunityId }))!.stageKey).toBe('submitted')

    // Simulated directly via SQL, not caller.opportunities.update — once a bid
    // exists, that procedure now rejects a direct stageKey patch (Task 10's
    // Global-Constraint guard). This mirrors the ONLY other legitimate way an
    // opportunity ends up further along than 'submitted': the bid-sync path
    // itself, exercised elsewhere; here we only need the "already past it" state.
    await pool.query(`UPDATE opportunities SET stage_key='won' WHERE id=$1`, [opportunityId])
    await caller.bids.update({ id: bid.id, patch: { stageKey: 'submitted' } }) // no-op re-trigger, already past 'submitted' in a different bid's lifecycle
    expect((await caller.opportunities.get({ id: opportunityId }))!.stageKey).toBe('won') // unchanged — sync never regresses a further-along opportunity
  })

  it('syncs the opportunity to won/dropped when the decision becomes final, unless already closed', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.bids.update({ id: bid.id, patch: { stageKey: 'submitted', decision: 'go' } })
    expect((await caller.opportunities.get({ id: opportunityId }))!.stageKey).toBe('won')
  })

  it('archives and unarchives a bid without touching any related data', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const archived = await caller.bids.archive({ id: bid.id })
    expect(archived.status).toBe('archived')
    expect(archived.archivedAt).not.toBeNull()
    const milestonesStillThere = await caller.bidMilestones.listForBid({ bidId: bid.id })
    expect(milestonesStillThere.length).toBeGreaterThan(0)
    const unarchived = await caller.bids.unarchive({ id: bid.id })
    expect(unarchived.status).toBe('active')
    expect(unarchived.archivedAt).toBeNull()
  })

  it('hard-deletes a bid with no history, cascading its milestones', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.bids.delete({ id: bid.id })
    expect(await caller.bids.get({ id: bid.id })).toBeNull()
    const milestonesGone = await pool.query('SELECT 1 FROM bid_milestones WHERE bid_id=$1', [bid.id])
    expect(milestonesGone.rows).toHaveLength(0)
  })

  it('refuses hard delete when the bid has a corrigendum, a protected value, a document, or a follow-up', async () => {
    const caller = appRouter.createCaller({})
    const bidWithCorrigendum = await caller.bids.create({ opportunityId })
    await pool.query(`INSERT INTO bid_corrigenda (bid_id, corrigendum_number) VALUES ($1, 1)`, [bidWithCorrigendum.id])
    await expect(caller.bids.delete({ id: bidWithCorrigendum.id })).rejects.toMatchObject({ code: 'CONFLICT' })

    const opp2 = await caller.opportunities.create({ departmentId, opportunityName: 'Second' })
    const bidWithProtectedValue = await caller.bids.create({ opportunityId: opp2.id })
    await pool.query(
      `INSERT INTO protected_values (entity_type, entity_id, field_key, frozen) VALUES ('bid', $1, 'submissionDeadline', true)`,
      [bidWithProtectedValue.id],
    )
    await expect(caller.bids.delete({ id: bidWithProtectedValue.id })).rejects.toMatchObject({ code: 'CONFLICT' })

    const opp3 = await caller.opportunities.create({ departmentId, opportunityName: 'Third' })
    const bidWithDocument = await caller.bids.create({ opportunityId: opp3.id })
    await pool.query(
      `INSERT INTO documents (entity_type, entity_id, filename, storage_path, content_type, size_bytes)
       VALUES ('bid', $1, 'f.pdf', 'bid-tracker/bid/x/y/f.pdf', 'application/pdf', 100)`,
      [bidWithDocument.id],
    )
    await expect(caller.bids.delete({ id: bidWithDocument.id })).rejects.toMatchObject({ code: 'CONFLICT' })

    const opp4 = await caller.opportunities.create({ departmentId, opportunityName: 'Fourth' })
    const bidWithFollowUp = await caller.bids.create({ opportunityId: opp4.id })
    await caller.followUps.create({ entityType: 'bid', entityId: bidWithFollowUp.id, dueDate: '2026-12-01' })
    await expect(caller.bids.delete({ id: bidWithFollowUp.id })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('explicitly deletes ownership assignments on hard delete, but permanently preserves audit-log rows', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const salesPerson = await caller.sales.create({ name: 'Test Rep', officialEmail: `rep-${Math.random()}@amnex.com`, designation: 'Account Manager', tierKey: 'accountManager' })
    await caller.ownership.assign({ entityType: 'bid', entityId: bid.id, salesPersonId: salesPerson.id, startDate: '2026-01-01' })
    await pool.query(
      `INSERT INTO commercial_audit_logs (entity_type, entity_id, field, old_value, new_value, action) VALUES ('bid', $1, 'stageKey', 'a', 'b', 'update')`,
      [bid.id],
    )
    await caller.bids.delete({ id: bid.id })
    const ownershipGone = await pool.query(`SELECT 1 FROM ownership_assignments WHERE entity_type='bid' AND entity_id=$1`, [bid.id])
    expect(ownershipGone.rows).toHaveLength(0)
    const auditStillThere = await pool.query(`SELECT 1 FROM commercial_audit_logs WHERE entity_type='bid' AND entity_id=$1`, [bid.id])
    expect(auditStillThere.rows).toHaveLength(1)
  })

  it('actionQueue lists open follow-ups for bids, with a computed attention flag', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const overdueFollowUp = await caller.followUps.create({ entityType: 'bid', entityId: bid.id, dueDate: '2020-01-01', note: 'Old task' })
    const queue = await caller.bids.actionQueue.list()
    const entry = queue.find((q: any) => q.followUpId === overdueFollowUp.id)
    expect(entry).toMatchObject({ bidId: bid.id, opportunityName: 'AI Document Processing System', attentionFlag: 'overdue' })
  })

  it('listForGrid filters by stageKey and never crashes on the myBids ($currentUser) rule with no signed-in user', async () => {
    const caller = appRouter.createCaller({})
    await caller.bids.create({ opportunityId })
    const solutioningOnly = await caller.bids.listForGrid({ filterRules: [{ field: 'stageKey', operator: 'eq', value: 'solutioning' }] })
    expect(solutioningOnly).toHaveLength(1)
    const myBids = await caller.bids.listForGrid({ filterRules: [{ field: 'ownerEmail', operator: 'eq', value: '$currentUser' }] })
    expect(myBids).toEqual([]) // no crash, no signed-in user (AUTH_ENFORCEMENT_ENABLED is off in tests) -> resolves to null -> matches nothing
  })

  it('listForGrid includes a computed attentionFlag per row', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    const milestone = (await caller.bidMilestones.listForBid({ bidId: bid.id })).find((m: any) => m.key === 'submissionDeadline')!
    await caller.bidMilestones.update({ id: milestone.id, patch: { dueAt: '2020-01-01T00:00:00.000Z' } })
    const grid = await caller.bids.listForGrid({})
    expect(grid.find((r: any) => r.id === bid.id)?.attentionFlag).toBe('overdue')
  })

  it('getForOpportunity returns the bid for an opportunity that has one, and null for one that does not', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    expect((await caller.bids.getForOpportunity({ opportunityId }))?.id).toBe(bid.id)

    const opp2 = await caller.opportunities.create({ departmentId, opportunityName: 'No bid yet' })
    expect(await caller.bids.getForOpportunity({ opportunityId: opp2.id })).toBeNull()
  })
})

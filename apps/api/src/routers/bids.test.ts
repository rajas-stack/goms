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
})

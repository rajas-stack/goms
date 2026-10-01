import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('bidMilestones router', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_corrigendum_changes')
    await pool.query('DELETE FROM bid_corrigenda')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Tender', submissionDate: '2026-10-10' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  it('lists the seeded submissionDeadline milestone', async () => {
    const caller = appRouter.createCaller({})
    const milestones = await caller.bidMilestones.listForBid({ bidId })
    expect(milestones.map((m: any) => m.key)).toContain('submissionDeadline')
  })

  it('listAll returns live milestones across bids with bid code and opportunity name, and omits archived bids', async () => {
    const caller = appRouter.createCaller({})
    const all = await caller.bidMilestones.listAll()
    const seeded = all.find((m: any) => m.key === 'submissionDeadline' && m.bidId === bidId)
    expect(seeded).toMatchObject({ opportunityName: 'Tender' })
    expect(seeded?.bidCode).toBeTruthy()

    await caller.bids.archive({ id: bidId })
    expect((await caller.bidMilestones.listAll()).some((m: any) => m.bidId === bidId)).toBe(false)
  })

  it('creates a new, independently-keyed milestone (e.g. a pre-bid conference)', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.bidMilestones.create({
      bidId, milestoneType: 'preBidConference', key: 'preBidConference', label: 'Pre-Bid Conference',
      dueAt: '2026-10-01T14:30:00.000Z', venue: 'SAG Lab Auditorium', notes: 'In-person attendance required.',
    })
    expect(created.venue).toBe('SAG Lab Auditorium')
  })

  it('rejects a duplicate key on the same bid', async () => {
    const caller = appRouter.createCaller({})
    await expect(
      caller.bidMilestones.create({ bidId, milestoneType: 'submissionDeadline', key: 'submissionDeadline', label: 'dup' })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('updating the submissionDeadline milestone writes opportunities.submissionDate in the same transaction', async () => {
    const caller = appRouter.createCaller({})
    const milestone = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    await caller.bidMilestones.update({ id: milestone.id, patch: { dueAt: '2026-11-01T00:00:00.000Z' } })
    const opp = await caller.opportunities.get({ id: opportunityId })
    expect(opp!.submissionDate).toContain('2026-11-01')
  })

  it('deletes a milestone', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.bidMilestones.create({ bidId, milestoneType: 'queryDeadline', key: 'query1', label: 'Query 1 Deadline' })
    await caller.bidMilestones.delete({ id: created.id })
    const remaining = await caller.bidMilestones.listForBid({ bidId })
    expect(remaining.find((m: any) => m.id === created.id)).toBeUndefined()
  })

  it('refuses to delete a milestone a pending corrigendum change still targets by key, but allows it once the change is decided', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.bidMilestones.create({ bidId, milestoneType: 'queryDeadline', key: 'query1', label: 'Query 1 Deadline' })
    const corrigendum = (await pool.query(
      `INSERT INTO bid_corrigenda (bid_id, corrigendum_number) VALUES ($1, 1) RETURNING id`, [bidId],
    )).rows[0]
    const change = (await pool.query(
      `INSERT INTO bid_corrigendum_changes (corrigendum_id, field_key, current_value, proposed_value)
       VALUES ($1, 'query1', '', 'new value') RETURNING id`,
      [corrigendum.id],
    )).rows[0]
    await expect(caller.bidMilestones.delete({ id: created.id })).rejects.toMatchObject({ code: 'CONFLICT' })

    await pool.query(`UPDATE bid_corrigendum_changes SET decision='accepted' WHERE id=$1`, [change.id])
    await caller.bidMilestones.delete({ id: created.id })
    const remaining = await caller.bidMilestones.listForBid({ bidId })
    expect(remaining.find((m: any) => m.id === created.id)).toBeUndefined()
  })
})

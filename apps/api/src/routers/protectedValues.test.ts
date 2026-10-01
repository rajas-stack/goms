import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('protectedValues router', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM protected_values')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Tender', valueAmount: '6.2', valueUnit: 'crore' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  it('freezes and unfreezes a field, requiring a reason only on unfreeze', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline' })
    let list = await caller.protectedValues.listFor({ entityType: 'bid', entityId: bidId })
    expect(list.find((p: any) => p.fieldKey === 'submissionDeadline')?.frozen).toBe(true)

    await expect(
      caller.protectedValues.unfreeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline', reason: '' })
    ).rejects.toThrow()

    await caller.protectedValues.unfreeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline', reason: 'Confirmed by client, safe to unfreeze' })
    list = await caller.protectedValues.listFor({ entityType: 'bid', entityId: bidId })
    expect(list.find((p: any) => p.fieldKey === 'submissionDeadline')?.frozen).toBe(false)
  })

  it('blocks a bidMilestones.update on the frozen submissionDeadline milestone', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline' })
    const milestone = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    await expect(
      caller.bidMilestones.update({ id: milestone.id, patch: { dueAt: '2026-12-25T00:00:00.000Z' } })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('blocks an opportunities.update on a frozen valueAmount', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'valueAmount' })
    await expect(
      caller.opportunities.update({ id: opportunityId, patch: { valueAmount: '99' } })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('blocks a bids.update on a frozen tenderLink', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'tenderLink' })
    await expect(
      caller.bids.update({ id: bidId, patch: { tenderLink: 'https://example.com' } })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

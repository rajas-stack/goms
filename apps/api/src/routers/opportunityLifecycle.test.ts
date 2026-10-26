import { describe, expect, it } from 'vitest'
import { appRouter } from '../index.js'

describe('opportunity lifecycle API', () => {
  async function campaign() {
    const caller = appRouter.createCaller({})
    const department = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: `Lifecycle ${crypto.randomUUID()}` })
    const opportunity = await caller.opportunities.create({ departmentId: department.id, opportunityName: 'Transit command centre' })
    return { caller, bid: await caller.bids.create({ opportunityId: opportunity.id, sheet: 'campaign' }) }
  }

  it('retains the same record and prior sales data through submission preparation and reversal', async () => {
    const { caller, bid } = await campaign()
    await caller.bids.update({ id: bid.id, patch: { lifecycleData: { clientNeed: 'Coordinate transit operations' } } })
    await caller.bids.update({ id: bid.id, patch: { sheet: 'pipeline-funnel' } })
    await caller.bids.update({ id: bid.id, patch: { lifecycleData: { expectedRfpDate: '2027-01-15' } } })
    for (const sheet of ['pipeline-backup', 'pipeline-commits', 'bidTracker', 'pipeline-commits'] as const) await caller.bids.update({ id: bid.id, patch: { sheet } })
    expect(await caller.bids.get({ id: bid.id })).toMatchObject({ id: bid.id, opportunityId: bid.opportunityId, sheet: 'pipeline-commits', lifecycleReachedSheet: 'bidTracker',
      lifecycleData: { clientNeed: 'Coordinate transit operations', expectedRfpDate: '2027-01-15' } })
    const rows = await caller.bids.listForGrid({})
    expect(rows.filter(row => row.id === bid.id)).toHaveLength(1)
    expect(rows.find(row => row.id === bid.id)?.lifecycleReachedSheet).toBe('bidTracker')
  })

  it('rejects skipped moves and future-stage data', async () => {
    const { caller, bid } = await campaign()
    await expect(caller.bids.update({ id: bid.id, patch: { sheet: 'pipeline-backup' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller.bids.update({ id: bid.id, patch: { lifecycleData: { resourcePlan: 'Too early' } } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await caller.bids.get({ id: bid.id }))?.sheet).toBe('campaign')
  })

  it('merges concurrent field edits inside the row lock', async () => {
    const { caller, bid } = await campaign()
    await Promise.all([
      caller.bids.update({ id: bid.id, patch: { lifecycleData: { clientNeed: 'Fleet visibility' } } }),
      caller.bids.update({ id: bid.id, patch: { lifecycleData: { leadSource: 'Department meeting' } } }),
    ])
    expect((await caller.bids.get({ id: bid.id }))?.lifecycleData).toEqual({ clientNeed: 'Fleet visibility', leadSource: 'Department meeting' })
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { lifecycleRowInSheet } from '@goms/domain'
import { repository, resetLocalData } from '@/data/repository'

describe('persisted opportunity lifecycle', () => {
  beforeEach(async () => { await resetLocalData() })

  async function campaign() {
    const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Transport command centre' })
    return repository.createBid(opportunity.id, undefined, 'campaign')
  }

  it('carries sales data on the same record through all stages and a reversal', async () => {
    const bid = await campaign()
    await repository.updateBid(bid.id, { lifecycleData: { clientNeed: 'Unify fleet operations' } })
    await repository.updateBid(bid.id, { sheet: 'pipeline-funnel' })
    await repository.updateBid(bid.id, { lifecycleData: { expectedRfpDate: '2027-01-15' } })
    for (const sheet of ['pipeline-backup', 'pipeline-commits', 'bidTracker', 'pipeline-commits'] as const) await repository.updateBid(bid.id, { sheet })
    const saved = await repository.getBid(bid.id)
    expect(saved).toMatchObject({ id: bid.id, opportunityId: bid.opportunityId, sheet: 'pipeline-commits', lifecycleReachedSheet: 'bidTracker',
      lifecycleData: { clientNeed: 'Unify fleet operations', expectedRfpDate: '2027-01-15' } })
    const rows = await repository.listBidsForGrid()
    expect(rows.filter(row => row.id === bid.id)).toHaveLength(1)
    for (const sheet of ['campaign', 'pipeline-funnel', 'pipeline-backup', 'pipeline-commits', 'bidTracker'] as const) expect(lifecycleRowInSheet(saved!, sheet)).toBe(true)
  })

  it('rejects skipped moves and future-stage writes without altering the record', async () => {
    const bid = await campaign()
    await expect(repository.updateBid(bid.id, { sheet: 'pipeline-backup' })).rejects.toThrow('one stage at a time')
    await expect(repository.updateBid(bid.id, { lifecycleData: { handoverNotes: 'Too soon' } })).rejects.toThrow('Commit')
    expect((await repository.getBid(bid.id))?.sheet).toBe('campaign')
  })

  it('merges separate field edits without erasing earlier entries and audits their contents', async () => {
    const bid = await campaign()
    await repository.updateBid(bid.id, { lifecycleData: { clientNeed: 'Fleet planning' } })
    await repository.updateBid(bid.id, { lifecycleData: { leadSource: 'Client meeting' } })
    expect((await repository.getBid(bid.id))?.lifecycleData).toEqual({ clientNeed: 'Fleet planning', leadSource: 'Client meeting' })
    const logs = await repository.listAuditLogs({ entityType: 'bid', entityId: bid.id })
    expect(logs.some(log => log.newValue.includes('Fleet planning'))).toBe(true)
  })
})

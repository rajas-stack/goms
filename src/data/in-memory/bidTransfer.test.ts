import { beforeEach, describe, expect, it, vi } from 'vitest'
import { repository, resetLocalData, getFullSnapshot } from '@/data/repository'

describe('atomic bid import', () => {
  beforeEach(resetLocalData)
  it('stages without changes, then adds new agnostic bids while preserving existing records', async () => {
    await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Existing' })
    const before = structuredClone(getFullSnapshot())
    const table = { headers: ['Opportunity Name', 'Tender ID'], rows: [['New', 'NEW/1'], ['Another', 'NEW/2']] }
    expect((await repository.previewBidImport({ table })).valid).toBe(true)
    expect(getFullSnapshot()).toEqual(before)
    expect(await repository.importBids({ table })).toEqual({ status: 'imported', count: 2 })
    expect((await repository.listBidsForGrid()).filter(b => ['New', 'Another'].includes(b.opportunityName))).toHaveLength(2)
    expect((await repository.listOpportunities()).find(o => o.id === before.opportunities[before.opportunities.length - 1].id)).toEqual(before.opportunities[before.opportunities.length - 1])
    const snapshot = structuredClone(getFullSnapshot())
    expect((await repository.importBids({ table })).status).toBe('rejected')
    expect(getFullSnapshot()).toEqual(snapshot)
  })
  it('rejects every row and preserves all data when one row fails validation', async () => {
    const before = structuredClone(getFullSnapshot())
    expect((await repository.importBids({ table: { headers: ['Opportunity Name', 'RFP Published Date'], rows: [['Good', '2026-10-19'], ['Bad', '32/13/2026']] } })).status).toBe('rejected')
    expect(getFullSnapshot()).toEqual(before)
  })
  it('does not publish a partly built batch after an unexpected write failure', async () => {
    const before = structuredClone(getFullSnapshot())
    const writer = vi.spyOn(Object.getPrototypeOf(repository), 'createOpportunity').mockRejectedValueOnce(new Error('Simulated failure'))
    try { await expect(repository.importBids({ table: { headers: ['Opportunity Name'], rows: [['New']] } })).rejects.toThrow('Simulated failure') }
    finally { writer.mockRestore() }
    expect(getFullSnapshot()).toEqual(before)
  })
})

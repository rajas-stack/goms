import { describe, it, expect, beforeEach } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

async function newBid(submissionDate = '2099-01-15') {
  const opp = await repository.createOpportunity({
    departmentId: 'dept-1', opportunityName: 'Smart Bus', submissionDate,
  })
  const bid = await repository.createBid(opp.id)
  return { opp, bid }
}

describe('InMemoryRepository Bid Tracker', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('createBid seeds a bid code and a submissionDeadline milestone from the opportunity', async () => {
    const { bid } = await newBid()
    expect(bid.bidCode).toMatch(/^BID-\d{4}-\d{4}$/)
    const [m] = await repository.listBidMilestones(bid.id)
    expect(m.key).toBe('submissionDeadline')
    expect(m.dueAt).toBe(new Date('2099-01-15').toISOString())
  })

  it('rejects a second bid for the same opportunity', async () => {
    const { opp } = await newBid()
    await expect(repository.createBid(opp.id)).rejects.toThrow(/already has a bid/)
  })

  it('gates Go before Submitted and derives the terminal stage from a decision', async () => {
    const { bid } = await newBid()
    await expect(repository.updateBid(bid.id, { decision: 'go' })).rejects.toThrow(/before the bid reaches Submitted/)
    const dropped = await repository.updateBid(bid.id, { decision: 'no_go' })
    expect(dropped.stageKey).toBe('dropped')
    const won = await repository.updateBid(bid.id, { stageKey: 'submitted', decision: 'go' })
    expect(won.stageKey).toBe('goApproved')
  })

  it('accepting a submissionDeadline corrigendum moves the milestone and the opportunity date', async () => {
    const { opp, bid } = await newBid()
    const cor = await repository.createBidCorrigendum({
      bidId: bid.id, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2099-01-15', proposedValue: '2099-02-01T00:00:00.000Z' }],
    })
    expect((await repository.getBid(bid.id))!.dataConfidence).toBe('needs_review')
    const rows = await repository.listBidsForGrid()
    expect(rows[0].attentionFlag).toBe('corrigendumPending')

    await repository.reviewCorrigendumChange({ changeId: cor.changes[0].id, decision: 'accepted' })
    const [m] = await repository.listBidMilestones(bid.id)
    expect(m.dueAt).toBe('2099-02-01T00:00:00.000Z')
    expect((await repository.getOpportunity(opp.id))!.submissionDate).toBe('2099-02-01')
    expect((await repository.listBidCorrigenda(bid.id))[0].status).toBe('reviewed')
    // Resolving the changes does not clear the flag by itself (same as the API)...
    expect((await repository.getBid(bid.id))!.dataConfidence).toBe('needs_review')
    // ...a person does, via markBidVerified.
    await repository.markBidVerified(bid.id)
    expect((await repository.getBid(bid.id))!.dataConfidence).toBe('verified')
  })

  // Protection is switched off (PROTECTED_VALUES_ENFORCED = false): a freeze record never blocks.
  it('accepts a change even when a freeze record exists', async () => {
    const { bid } = await newBid()
    const cor = await repository.createBidCorrigendum({
      bidId: bid.id, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: 'a', proposedValue: 'b' }],
    })
    await repository.freezeValue('bid', bid.id, 'submissionDeadline')
    await expect(repository.reviewCorrigendumChange({ changeId: cor.changes[0].id, decision: 'accepted' })).resolves.toBeTruthy()
  })

  it('deleteBid is blocked once the bid has a corrigendum; archive still works', async () => {
    const { bid } = await newBid()
    await repository.createBidCorrigendum({
      bidId: bid.id, corrigendumNumber: 1,
      changes: [{ fieldKey: 'tenderLink', currentValue: '', proposedValue: 'http://x' }],
    })
    await expect(repository.deleteBid(bid.id)).rejects.toThrow(/archive it instead/)
    expect((await repository.archiveBid(bid.id)).status).toBe('archived')
  })

  it('lists system saved views ahead of user views and protects them', async () => {
    const view = await repository.createBidSavedView({ name: 'Mine', scope: 'personal' })
    const views = await repository.listBidSavedViews()
    expect(views[0].isSystem).toBe(true)
    expect(views[views.length - 1].id).toBe(view.id)
    await expect(repository.deleteBidSavedView('allBids')).rejects.toThrow(/System views/)
  })
})

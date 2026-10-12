import { beforeEach, describe, expect, it } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'
import { buildTenderPosition } from './tenderPosition'

const clause = (fieldKey: string, currentValue: string, proposedValue: string) =>
  ({ fieldKey, currentValue, proposedValue, kind: 'clause' as const, clauseTitle: fieldKey, affectedModule: 'pq' as const })

describe('appending clause changes to an existing corrigendum (local repository)', () => {
  beforeEach(() => resetLocalData())

  async function bidWithC1() {
    const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Grid tender' })
    const bid = await repository.createBid(opp.id)
    const c1 = await repository.createBidCorrigendum({ bidId: bid.id, corrigendumNumber: 1, changes: [clause('pq.a', 'x', 'y')] })
    return { bid, c1 }
  }

  it('adds a grid-linked change to C1 and reopens its review', async () => {
    const { bid, c1 } = await bidWithC1()
    await repository.reviewCorrigendumChange({ changeId: c1.changes[0].id, decision: 'accepted' })
    const updated = await repository.addCorrigendumChanges({ corrigendumId: c1.id, changes: [clause('grid:pq:r1:c1', '₹100 Crore', '₹75 Crore')] })
    expect(updated.changes.map((c) => c.fieldKey)).toEqual(['pq.a', 'grid:pq:r1:c1'])
    expect(updated.status).toBe('pending_review')
    const position = buildTenderPosition(await repository.listBidCorrigenda(bid.id))
    expect(position.find((h) => h.key === 'grid:pq:r1:c1')?.current.value).toBe('₹75 Crore')
  })

  it('rejects a clause the corrigendum already changes and non-clause changes', async () => {
    const { c1 } = await bidWithC1()
    await expect(repository.addCorrigendumChanges({ corrigendumId: c1.id, changes: [clause('pq.a', 'y', 'z')] })).rejects.toThrow(/only once/)
    await expect(repository.addCorrigendumChanges({ corrigendumId: c1.id, changes: [{ fieldKey: 'tenderLink', currentValue: '', proposedValue: 'https://x' }] }))
      .rejects.toThrow(/Only clause changes/)
  })
})

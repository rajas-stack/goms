import { beforeEach, describe, expect, it } from 'vitest'
import { repository, resetLocalData, getFullSnapshot, restoreFromBackup } from './repository'
import { migrateSnapshot } from './migrations'
import { paragraph, starterDocument } from '@/modules/bid-tracker/synopsis/documents'
import { documentToGeneral, generalToDocument } from '@goms/domain'

async function bid(name: string) {
  const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name })
  return repository.createBid(opportunity.id)
}

describe('bid synopsis persistence', () => {
  beforeEach(() => resetLocalData())
  it('keeps content separate by bid and section, and survives backup restore', async () => {
    const a = await bid('A'), b = await bid('B')
    const document = starterDocument('pq')
    const saved = await repository.saveBidSynopsis({ bidId: a.id, section: 'pq', document, expectedRevision: 0 })
    expect(saved.revision).toBe(1)
    expect(await repository.getBidSynopsis(a.id, 'tq')).toBeNull()
    expect(await repository.getBidSynopsis(b.id, 'pq')).toBeNull()
    const snapshot = getFullSnapshot()
    await resetLocalData()
    restoreFromBackup(snapshot)
    expect((await repository.getBidSynopsis(a.id, 'pq'))?.document).toEqual(document)
  })

  it('rejects stale writes and does not share mutable references', async () => {
    const a = await bid('A'), document = starterDocument('scope')
    const input = { bidId: a.id, section: 'scope' as const, document, expectedRevision: 0 }
    const saved = await repository.saveBidSynopsis(input)
    document.content!.push(paragraph('Accidental mutation'))
    saved.document.content!.push(paragraph('Another mutation'))
    expect((await repository.getBidSynopsis(a.id, 'scope'))?.document.content).toHaveLength(1)
    await expect(repository.saveBidSynopsis(input)).rejects.toThrow(/changed elsewhere/)
    expect((await repository.getBidSynopsis(a.id, 'scope'))?.revision).toBe(1)
  })

  it('projects General fields into grid rows and filters them through their shared keys', async () => {
    const a = await bid('A'), b = await bid('B')
    await repository.saveBidSynopsis({ bidId: a.id, section: 'general', document: generalToDocument({ scopeOfWork: 'Smart transit', publishingDate: '2026-10-10' }), expectedRevision: 0 })
    const rows = await repository.listBidsForGrid([{ field: 'general:scopeOfWork', operator: 'contains', value: 'transit' }])
    expect(rows.map(row => row.id)).toEqual([a.id])
    expect(rows[0].generalValues).toMatchObject({ scopeOfWork: 'Smart transit', publishingDate: '2026-10-10' })
    expect((await repository.listBidsForGrid([{ field: 'general:publishingDate', operator: 'after', value: '2026-10-09' }])).map(row => row.id)).toEqual([a.id])
    expect(b.id).not.toBe(a.id)
  })

  it('keeps linked General values in sync when an opportunity value changes or is cleared', async () => {
    const a = await bid('A')
    await repository.saveBidSynopsis({ bidId: a.id, section: 'general', document: generalToDocument({ tenderId: 'Legacy tender', referenceNo: 'Legacy reference' }), expectedRevision: 0 })
    await repository.updateOpportunity(a.opportunityId, { gemTenderId: 'New tender', referenceNo: 'New reference' })
    expect(documentToGeneral((await repository.getBidSynopsis(a.id, 'general'))?.document)).toMatchObject({ tenderId: 'New tender', referenceNo: 'New reference' })
    await repository.updateOpportunity(a.opportunityId, { gemTenderId: '', referenceNo: '' })
    const row = (await repository.listBidsForGrid()).find(candidate => candidate.id === a.id)!
    expect(row.gemTenderId).toBe('')
    expect(row.referenceNo).toBe('')
  })

  it('migrates old snapshots without dropping data and removes sections when a bid is deleted', async () => {
    const a = await bid('A')
    await repository.saveBidSynopsis({ bidId: a.id, section: 'pq', document: starterDocument('pq'), expectedRevision: 0 })
    const snapshot = getFullSnapshot()
    const { bidSynopsis: _old, ...legacy } = snapshot
    const migrated = migrateSnapshot(legacy, 22)
    expect(migrated?.bidSynopsis).toEqual([])
    expect(migrated?.bids).toEqual(snapshot.bids)
    await repository.deleteBid(a.id)
    expect(getFullSnapshot().bidSynopsis).toEqual([])
  })
})

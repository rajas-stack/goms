import { beforeEach, describe, expect, it } from 'vitest'
import { getFullSnapshot, repository, resetLocalData, restoreFromBackup } from '@/data/repository'
import { SCHEMA_VERSION, migrateSnapshot } from '@/data/migrations'
import { corrigendumStats } from './model'
import {
  SAMPLE_C1_DATE, SAMPLE_C1_TURNOVER, SAMPLE_C2_DATE, SAMPLE_ORIGINAL_TENDER, loadSampleCorrigenda, sampleC1,
} from './sampleCorrigenda'
import { buildTenderPosition, currentSourceLabel, versionChain } from './tenderPosition'

async function bidWithSample() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'ITMS Tender' })
  const bid = await repository.createBid(opp.id)
  await loadSampleCorrigenda(bid.id, [], (input) => repository.createBidCorrigendum(input))
  return bid
}
const positionOf = async (bidId: string) => buildTenderPosition(await repository.listBidCorrigenda(bidId))
const clauseOf = async (bidId: string, key: string) => (await positionOf(bidId)).find((h) => h.key === key)!

describe('corrigendum version history (local repository)', () => {
  beforeEach(() => resetLocalData())

  it('1 · never loses the original tender value, even after two corrigenda', async () => {
    const bid = await bidWithSample()
    const position = await positionOf(bid.id)
    for (const [key, original] of Object.entries(SAMPLE_ORIGINAL_TENDER)) {
      expect(position.find((h) => h.key === key)?.original).toBe(original.text)
    }
  })

  it('2 · C1 modifies the original correctly', async () => {
    const bid = await bidWithSample()
    const turnover = await clauseOf(bid.id, 'pq.turnover')
    expect(turnover.versions).toHaveLength(1)
    expect(turnover.versions[0]).toMatchObject({ corrigendumNumber: 1, before: SAMPLE_ORIGINAL_TENDER['pq.turnover'].text, after: SAMPLE_C1_TURNOVER })
    expect(turnover.current.value).toBe(SAMPLE_C1_TURNOVER)
  })

  it('3 · C2 can modify a clause C1 already modified, chaining from C1’s value', async () => {
    const bid = await bidWithSample()
    const date = await clauseOf(bid.id, 'dates.submission')
    expect(date.versions.map((v) => [v.corrigendumNumber, v.before, v.after])).toEqual([
      [1, SAMPLE_ORIGINAL_TENDER['dates.submission'].text, SAMPLE_C1_DATE],
      [2, SAMPLE_C1_DATE, SAMPLE_C2_DATE],
    ])
  })

  it('4 · Current View shows the latest valid value and where it came from', async () => {
    const bid = await bidWithSample()
    const date = await clauseOf(bid.id, 'dates.submission')
    expect(date.current.value).toBe(SAMPLE_C2_DATE)
    expect(currentSourceLabel(date)).toBe('Updated through C2')
    expect(currentSourceLabel(await clauseOf(bid.id, 'manpower.pm'))).toBe('Updated through C1')
  })

  it('4b · a rejected change falls back to the previous valid version', async () => {
    const bid = await bidWithSample()
    const date = await clauseOf(bid.id, 'dates.submission')
    await repository.reviewCorrigendumChange({ changeId: date.versions[1].changeId, decision: 'rejected' })
    const after = await clauseOf(bid.id, 'dates.submission')
    expect(after.current.value).toBe(SAMPLE_C1_DATE)
    expect(after.versions).toHaveLength(2) // history keeps the rejected version
  })

  it('5 · History View shows the complete evolution Original → C1 → C2 → Current', async () => {
    const bid = await bidWithSample()
    const corrigenda = await repository.listBidCorrigenda(bid.id)
    expect(versionChain(corrigenda)).toEqual(['Original Tender', 'C1', 'C2', 'Current Effective'])
    const date = await clauseOf(bid.id, 'dates.submission')
    expect([date.original, ...date.versions.map((v) => v.after)]).toEqual([SAMPLE_ORIGINAL_TENDER['dates.submission'].text, SAMPLE_C1_DATE, SAMPLE_C2_DATE])
  })

  it('9 · identifies the affected module of every change', async () => {
    const bid = await bidWithSample()
    const position = await positionOf(bid.id)
    expect(Object.fromEntries(position.map((h) => [h.key, h.module]))).toEqual({
      'pq.turnover': 'pq', 'manpower.pm': 'manpower', 'dates.submission': 'dates', 'payment.golive': 'payment_terms', 'boq.cctv': 'boq',
    })
    const [c1, c2] = await repository.listBidCorrigenda(bid.id)
    expect(c2.changes.map((c) => c.classification)).toEqual(['date_changed', 'commercial_changed', 'quantity_changed'])
    expect(corrigendumStats(c1)).toEqual({ numberOfChanges: 3, openActions: 3 })
  })

  it('10 · history and register survive a persisted-store round trip (refresh/reopen)', async () => {
    const bid = await bidWithSample()
    const [c1] = await repository.listBidCorrigenda(bid.id)
    await repository.updateBidCorrigendumRegister({ corrigendumId: c1.id, patch: { reviewStatus: 'closed', remarks: 'Closed in review meeting' } })
    const before = await repository.listBidCorrigenda(bid.id)
    // What IndexedDB stores is a structured clone of the snapshot, read back
    // through the schema migrator on the next start.
    const stored = structuredClone(getFullSnapshot())
    await resetLocalData()
    expect(await repository.listBidCorrigenda(bid.id)).toEqual([])
    restoreFromBackup(migrateSnapshot(stored, SCHEMA_VERSION)!)
    const after = await repository.listBidCorrigenda(bid.id)
    expect(after).toEqual(before)
    expect(after[0]).toMatchObject({ reviewStatus: 'closed', remarks: 'Closed in review meeting', publishedDate: '2026-09-22' })
    expect(buildTenderPosition(after)).toEqual(buildTenderPosition(before))
  })

  it('reads a pre-Part-1 snapshot (no register/clause fields) with safe defaults', async () => {
    const bid = await bidWithSample()
    const stored = structuredClone(getFullSnapshot())
    const legacy = {
      ...stored,
      bidCorrigenda: stored.bidCorrigenda.map(({ id, bidId, corrigendumNumber, sourceDocumentId, detectedAt, reviewedAt, reviewedBy, status }) =>
        ({ id, bidId, corrigendumNumber, sourceDocumentId, detectedAt, reviewedAt, reviewedBy, status })),
      bidCorrigendumChanges: stored.bidCorrigendumChanges.map(({ id, corrigendumId, fieldKey, currentValue, proposedValue, decision, decidedAt, decidedBy }) =>
        ({ id, corrigendumId, fieldKey, currentValue, proposedValue, decision, decidedAt, decidedBy })),
    }
    restoreFromBackup(legacy as typeof stored)
    const [c1] = await repository.listBidCorrigenda(bid.id)
    expect(c1).toMatchObject({ reviewStatus: 'pending', impactLevel: 'medium', affectedSections: [], remarks: '' })
    expect(c1.changes[0]).toMatchObject({ kind: 'field', currentValue: SAMPLE_ORIGINAL_TENDER['pq.turnover'].text })
  })

  it('updating the register never rewrites recorded changes', async () => {
    const bid = await bidWithSample()
    const [c1] = await repository.listBidCorrigenda(bid.id)
    const updated = await repository.updateBidCorrigendumRegister({ corrigendumId: c1.id, patch: { impactLevel: 'critical', reviewOwnerId: 'dtm-1' } })
    expect(updated.changes).toEqual(c1.changes)
    expect(updated).toMatchObject({ impactLevel: 'critical', reviewOwnerId: 'dtm-1', publishedDate: '2026-09-22' })
  })

  it('accepting a clause change records the decision without touching milestones', async () => {
    const bid = await bidWithSample()
    const milestonesBefore = await repository.listBidMilestones(bid.id)
    const [c1] = await repository.listBidCorrigenda(bid.id)
    await repository.reviewCorrigendumChange({ changeId: c1.changes[0].id, decision: 'accepted' })
    expect(await repository.listBidMilestones(bid.id)).toEqual(milestonesBefore)
    expect((await repository.listBidCorrigenda(bid.id))[0].changes[0].decision).toBe('accepted')
  })

  it('refuses to load the sample onto a bid that already has corrigenda, and rejects duplicate clauses', async () => {
    const bid = await bidWithSample()
    const existing = await repository.listBidCorrigenda(bid.id)
    await expect(loadSampleCorrigenda(bid.id, existing, (i) => repository.createBidCorrigendum(i))).rejects.toThrow(/already has corrigenda/)
    const dup = sampleC1(bid.id)
    await expect(repository.createBidCorrigendum({ ...dup, corrigendumNumber: 9, changes: [dup.changes[0], dup.changes[0]] }))
      .rejects.toThrow(/only once per corrigendum/)
  })
})

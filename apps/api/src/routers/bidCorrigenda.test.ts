import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('bidCorrigenda router', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_corrigendum_changes')
    await pool.query('DELETE FROM bid_corrigenda')
    await pool.query('DELETE FROM documents')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Tender', submissionDate: '2026-10-15' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  it('creates a corrigendum against the existing submissionDeadline milestone, and downgrades data confidence', async () => {
    const caller = appRouter.createCaller({})
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18' }],
    })
    expect(corrigendum.status).toBe('pending_review')
    const bid = await caller.bids.get({ id: bidId })
    expect(bid!.dataConfidence).toBe('needs_review')
  })

  it('rejects a change whose fieldKey has no existing milestone slot and is not tenderLink', async () => {
    const caller = appRouter.createCaller({})
    await expect(
      caller.bidCorrigenda.create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'cor_9_z', currentValue: '', proposedValue: 'x' }] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a change against a pre-existing empty milestone slot (the "cor_2_a/b" pattern)', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidMilestones.create({ bidId, milestoneType: 'corrigendumDate', key: 'cor_2_a', label: 'Corrigendum 2 — Occurrence 1' })
    await expect(
      caller.bidCorrigenda.create({ bidId, corrigendumNumber: 2, changes: [{ fieldKey: 'cor_2_a', currentValue: '', proposedValue: '2026-11-01T00:00:00.000Z' }] })
    ).resolves.toMatchObject({ corrigendumNumber: 2 })
  })

  it('rejects a duplicate corrigendumNumber for the same bid', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidCorrigenda.create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2026-10-18' }] })
    await expect(
      caller.bidCorrigenda.create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2026-10-19' }] })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('lists corrigenda for a bid, newest-numbered included', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidCorrigenda.create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2026-10-18' }] })
    const list = await caller.bidCorrigenda.listForBid({ bidId })
    expect(list).toHaveLength(1)
    expect(list[0].changes).toHaveLength(1)
  })

  it('rejects a sourceDocumentId that belongs to a different bid', async () => {
    const caller = appRouter.createCaller({})
    const opp2 = await caller.opportunities.create({ departmentId: (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Other Dept' })).id, opportunityName: 'Other Tender' })
    const otherBid = await caller.bids.create({ opportunityId: opp2.id })
    const otherDoc = (await pool.query(
      `INSERT INTO documents (entity_type, entity_id, filename, storage_path, content_type, size_bytes)
       VALUES ('bid', $1, 'f.pdf', 'bid-tracker/bid/x/y/f.pdf', 'application/pdf', 100) RETURNING id`,
      [otherBid.id],
    )).rows[0]
    await expect(
      caller.bidCorrigenda.create({
        bidId, corrigendumNumber: 1, sourceDocumentId: otherDoc.id,
        changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2026-10-18' }],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepting a change applies the proposed value to the milestone and syncs submissionDate', async () => {
    const caller = appRouter.createCaller({})
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18T00:00:00.000Z' }],
    })
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'accepted' })
    const milestone = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    // due_at is TIMESTAMPTZ — pg returns a Date object through the in-process
    // caller (unlike opportunities.submission_date, a plain TEXT column), so
    // normalize to an ISO string before substring-matching.
    expect(new Date(milestone.dueAt).toISOString()).toContain('2026-10-18')
    const opp = await caller.opportunities.get({ id: opportunityId })
    expect(opp!.submissionDate).toContain('2026-10-18')
  })

  it('rejecting a change leaves the milestone untouched', async () => {
    const caller = appRouter.createCaller({})
    const before = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18T00:00:00.000Z' }],
    })
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'rejected', reason: 'Not applicable to us' })
    const after = (await caller.bidMilestones.listForBid({ bidId })).find((m: any) => m.key === 'submissionDeadline')!
    // due_at is a Date object here (see the "accepting a change" test above)
    // — two separately-fetched Date instances for the same timestamp are
    // never referentially `.toBe`-equal, so compare their ISO values instead.
    expect(new Date(after.dueAt).toISOString()).toBe(new Date(before.dueAt).toISOString())
  })

  it('blocks accepting a change on a frozen field', async () => {
    const caller = appRouter.createCaller({})
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline' })
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '2026-10-15', proposedValue: '2026-10-18T00:00:00.000Z' }],
    })
    await expect(caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'accepted' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await caller.protectedValues.unfreeze({ entityType: 'bid', entityId: bidId, fieldKey: 'submissionDeadline', reason: 'Client confirmed the extension' })
    await expect(caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'accepted' })).resolves.toBeDefined()
  })

  it('status flips to reviewed only once every change is resolved, not before', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidMilestones.create({ bidId, milestoneType: 'corrigendumDate', key: 'cor_2_a', label: 'Occ 1' })
    await caller.bidMilestones.create({ bidId, milestoneType: 'corrigendumDate', key: 'cor_2_b', label: 'Occ 2' })
    const corrigendum = await caller.bidCorrigenda.create({
      bidId, corrigendumNumber: 2,
      changes: [
        { fieldKey: 'cor_2_a', currentValue: '', proposedValue: '2026-11-01T00:00:00.000Z' },
        { fieldKey: 'cor_2_b', currentValue: '', proposedValue: '2026-11-05T00:00:00.000Z' },
      ],
    })
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[0].id, decision: 'accepted' })
    let list = await caller.bidCorrigenda.listForBid({ bidId })
    expect(list[0].status).toBe('pending_review')
    await caller.bidCorrigenda.reviewChange({ changeId: corrigendum.changes[1].id, decision: 'rejected', reason: 'Superseded' })
    list = await caller.bidCorrigenda.listForBid({ bidId })
    expect(list[0].status).toBe('reviewed')
  })
})

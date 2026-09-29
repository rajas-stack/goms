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
})

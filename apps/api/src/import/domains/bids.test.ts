import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { appRouter } from '../../index.js'
import { validateBidRows, commitBidRows } from './bids.js'

describe('bids import domain', () => {
  let opportunityId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_custom_field_values')
    await pool.query('DELETE FROM bid_custom_fields')
    await pool.query(`DELETE FROM commercial_audit_logs WHERE entity_type IN ('bidCustomField','bidCustomFieldValue')`)
    await pool.query('DELETE FROM protected_values')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Imported Tender', gemTenderId: 'DRDO-SAG-2026-T881' })).id
  })

  async function withClient<T>(fn: (client: any) => Promise<T>) {
    const client = await pool.connect()
    try { return await fn(client) } finally { client.release() }
  }

  it('classifies a row with an exact GeM Tender ID match as create, then a later row for the same tender ID as update', async () => {
    await withClient(async (client) => {
      const preview = await validateBidRows(client, [{ gemTenderId: 'DRDO-SAG-2026-T881', tenderLink: 'https://example.com' }])
      expect(preview[0].action).toBe('create')
      await commitBidRows(client, [{ gemTenderId: 'DRDO-SAG-2026-T881', tenderLink: 'https://example.com' }], preview)

      const secondPreview = await validateBidRows(client, [{ gemTenderId: 'DRDO-SAG-2026-T881', tenderLink: 'https://example.com/v2' }])
      expect(secondPreview[0].action).toBe('update')
    })
  })

  it('rejects a GeM Tender ID that matches no opportunity and has no plausible near-miss', async () => {
    await withClient(async (client) => {
      const preview = await validateBidRows(client, [{ gemTenderId: 'TOTALLY-UNRELATED-000', tenderLink: '' }])
      expect(preview[0].action).toBe('reject')
    })
  })

  it('classifies a near-miss GeM Tender ID as needs-review with a real fuzzy candidate; a bulk commit downgrades that candidate\'s EXISTING bid without applying the unresolved row', async () => {
    await withClient(async (client) => {
      const existingBid = await appRouter.createCaller({}).bids.create({ opportunityId })
      const rows = [{ gemTenderId: 'DRDO-SAG-2026-T881X', tenderLink: 'https://example.com/corrigendum' }]
      const preview = await validateBidRows(client, rows)
      expect(preview[0].action).toBe('needs-review')
      expect(preview[0].candidates?.[0]?.key).toBe('DRDO-SAG-2026-T881')

      await commitBidRows(client, rows, preview)
      const bid = (await pool.query('SELECT * FROM bids WHERE id=$1', [existingBid.id])).rows[0]
      expect(bid.data_confidence).toBe('needs_review')
      expect(bid.tender_link).toBeNull()
    })
  })

  it('sets data_confidence to verified on a clean create', async () => {
    await withClient(async (client) => {
      const preview = await validateBidRows(client, [{ gemTenderId: 'DRDO-SAG-2026-T881', tenderLink: 'https://example.com' }])
      await commitBidRows(client, [{ gemTenderId: 'DRDO-SAG-2026-T881', tenderLink: 'https://example.com' }], preview)
    })
    const bid = (await pool.query('SELECT * FROM bids WHERE opportunity_id=$1', [opportunityId])).rows[0]
    expect(bid.data_confidence).toBe('verified')
  })

  it('refuses to overwrite a frozen tenderLink on commit — the import path uses the same protected-value guard as every direct edit', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bid.id, fieldKey: 'tenderLink' })
    await withClient(async (client) => {
      const rows = [{ gemTenderId: 'DRDO-SAG-2026-T881', tenderLink: 'https://example.com/new' }]
      const preview = await validateBidRows(client, rows)
      expect(preview[0].action).toBe('update')
      await expect(commitBidRows(client, rows, preview)).rejects.toMatchObject({ code: 'CONFLICT' })
    })
  })

  it('a blank tenderLink cell is "no change": it neither clears the link nor trips a frozen one', async () => {
    const caller = appRouter.createCaller({})
    const bid = await caller.bids.create({ opportunityId })
    await caller.bids.update({ id: bid.id, patch: { tenderLink: 'https://keep.me' } })
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bid.id, fieldKey: 'tenderLink' })
    await withClient(async (client) => {
      const rows = [{ gemTenderId: 'DRDO-SAG-2026-T881', tenderLink: '' }]
      const preview = await validateBidRows(client, rows)
      expect(preview[0].action).toBe('unchanged')
      await commitBidRows(client, rows, preview)
    })
    expect((await pool.query('SELECT tender_link FROM bids WHERE id=$1', [bid.id])).rows[0].tender_link).toBe('https://keep.me')
  })

  describe('custom columns', () => {
    const fieldsOf = () => appRouter.createCaller({}).bidCustomFields

    it('fills an existing custom column by its name or custom:<key> heading, typed, on create and update, with an audit trail', async () => {
      const score = await fieldsOf().create({ name: 'Win Score', dataType: 'number' })
      const tier = await fieldsOf().create({ name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
      await withClient(async (client) => {
        const create = [{ gemTenderId: 'DRDO-SAG-2026-T881', 'win score': '42.5', 'custom:tier': 'Gold' }]
        const preview = await validateBidRows(client, create)
        expect(preview[0].action).toBe('create')
        await commitBidRows(client, create, preview)

        const bidId = (await pool.query('SELECT id FROM bids WHERE opportunity_id=$1', [opportunityId])).rows[0].id
        expect(await fieldsOf().valuesForBid({ bidId })).toEqual({ win_score: 42.5, tier: 'Gold' })

        const update = [{ gemTenderId: 'DRDO-SAG-2026-T881', 'Win Score': '50', Tier: 'Silver' }]
        const second = await validateBidRows(client, update)
        expect(second[0].action).toBe('update')
        expect(second[0].diff).toEqual([
          { field: 'custom:win_score', oldValue: '42.5', newValue: '50' },
          { field: 'custom:tier', oldValue: 'Gold', newValue: 'Silver' },
        ])
        await commitBidRows(client, update, second)
        expect(await fieldsOf().valuesForBid({ bidId })).toEqual({ win_score: 50, tier: 'Silver' })

        const unchanged = await validateBidRows(client, update)
        expect(unchanged[0].action).toBe('unchanged')
        const audits = (await pool.query(`SELECT field, old_value, new_value, reason FROM commercial_audit_logs WHERE entity_type='bidCustomFieldValue' AND entity_id=$1 ORDER BY changed_at, field`, [bidId])).rows
        expect(audits.filter((a) => a.field === 'win_score').map((a) => [a.old_value, a.new_value, a.reason])).toEqual([['', '42.5', 'Imported'], ['42.5', '50', 'Imported']])
      })
      expect((await fieldsOf().list({ includeArchived: true })).every((f) => f.hasHeldValue)).toBe(true)
      void score; void tier
    })

    it('rejects a row whose custom value is invalid for the column, naming the column', async () => {
      await fieldsOf().create({ name: 'Win Score', dataType: 'number' })
      await fieldsOf().create({ name: 'Tier', dataType: 'select', options: ['Gold'] })
      await withClient(async (client) => {
        const preview = await validateBidRows(client, [
          { gemTenderId: 'DRDO-SAG-2026-T881', 'Win Score': 'abc' },
        ])
        expect(preview[0].action).toBe('reject')
        expect(preview[0].errors[0]).toMatch(/Column "Win Score".*valid number/)
        const selectPreview = await validateBidRows(client, [{ gemTenderId: 'DRDO-SAG-2026-T881', Tier: 'Bronze' }])
        expect(selectPreview[0].errors[0]).toMatch(/Column "Tier".*not one of/)
      })
    })

    it('never creates a column for an unknown heading: it warns, imports the rest, ignores the values and flags the bid for review', async () => {
      await withClient(async (client) => {
        const rows = [{ gemTenderId: 'DRDO-SAG-2026-T881', tenderLink: 'https://example.com', 'Client Mood': 'happy', Empty: '' }]
        const preview = await validateBidRows(client, rows)
        expect(preview[0].action).toBe('create') // not blocked
        expect(preview[0].warnings?.[0]).toMatch(/Unknown column ignored: Client Mood/)
        expect(preview[0].warnings?.[0]).not.toMatch(/Empty/) // a blank unknown column is just ignored
        await commitBidRows(client, rows, preview)
      })
      expect((await pool.query('SELECT * FROM bid_custom_fields')).rows).toHaveLength(0) // nothing was created
      const bid = (await pool.query('SELECT * FROM bids WHERE opportunity_id=$1', [opportunityId])).rows[0]
      expect(bid.tender_link).toBe('https://example.com')
      expect(bid.data_confidence).toBe('needs_review')
    })

    it('reports a heading that matches an ARCHIVED column as unknown (noting it is archived)', async () => {
      const f = await fieldsOf().create({ name: 'Old Notes', dataType: 'text' })
      await fieldsOf().archive({ id: f.id })
      await withClient(async (client) => {
        const preview = await validateBidRows(client, [{ gemTenderId: 'DRDO-SAG-2026-T881', 'Old Notes': 'x' }])
        expect(preview[0].warnings?.[0]).toMatch(/Old Notes \(archived column\)/)
      })
    })

    it('a blank custom cell is "no change", never a clear', async () => {
      const note = await fieldsOf().create({ name: 'Note', dataType: 'text' })
      const caller = appRouter.createCaller({})
      const bid = await caller.bids.create({ opportunityId })
      await fieldsOf().setValue({ bidId: bid.id, fieldId: note.id, value: 'keep me' })
      await withClient(async (client) => {
        const rows = [{ gemTenderId: 'DRDO-SAG-2026-T881', Note: '' }]
        const preview = await validateBidRows(client, rows)
        expect(preview[0].action).toBe('unchanged')
        await commitBidRows(client, rows, preview)
      })
      expect(await fieldsOf().valuesForBid({ bidId: bid.id })).toEqual({ note: 'keep me' })
    })
  })
})

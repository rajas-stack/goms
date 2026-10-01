import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { appRouter } from '../../index.js'
import { validateBidMilestoneRows, commitBidMilestoneRows } from './bidMilestones.js'

describe('bidMilestones import domain', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM bid_custom_field_values')
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
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Imported Tender', gemTenderId: 'DRDO-SAG-2026-T900' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  const row = (over: Record<string, string> = {}) => ({
    gemTenderId: 'DRDO-SAG-2026-T900', milestoneType: 'queryDeadline', key: 'query1', label: 'Query 1', dueAt: '', venue: '', notes: '', ...over,
  })

  async function withClient<T>(fn: (client: any) => Promise<T>) {
    const client = await pool.connect()
    try { return await fn(client) } finally { client.release() }
  }

  it('creates a new, independently-keyed milestone for a resolvable tender ID', async () => {
    await withClient(async (client) => {
      const rows = [row({ milestoneType: 'preBidConference', key: 'preBidConference', label: 'Pre-Bid Conference', dueAt: '2026-10-01T14:30:00.000Z', venue: 'Delhi' })]
      const preview = await validateBidMilestoneRows(client, rows)
      expect(preview[0].action).toBe('create')
      await commitBidMilestoneRows(client, rows, preview)
      const milestone = (await pool.query(`SELECT * FROM bid_milestones WHERE bid_id=$1 AND key='preBidConference'`, [bidId])).rows[0]
      expect(milestone.venue).toBe('Delhi')
    })
  })

  it('rejects a tender ID with no bid yet, even if the opportunity exists', async () => {
    const departmentId = (await pool.query('SELECT department_id FROM opportunities WHERE id=$1', [opportunityId])).rows[0].department_id
    await appRouter.createCaller({}).opportunities.create({ departmentId, opportunityName: 'No bid yet', gemTenderId: 'ZZZ-0001' })
    await withClient(async (client) => {
      const preview = await validateBidMilestoneRows(client, [row({ gemTenderId: 'ZZZ-0001' })])
      expect(preview[0].action).toBe('reject')
    })
  })

  it('classifies a near-miss tender ID as needs-review with a real fuzzy candidate', async () => {
    await withClient(async (client) => {
      const preview = await validateBidMilestoneRows(client, [row({ gemTenderId: 'DRDO-SAG-2026-T900X' })])
      expect(preview[0].action).toBe('needs-review')
      expect(preview[0].candidates?.[0]?.key).toBe('DRDO-SAG-2026-T900')
    })
  })

  it('refuses to overwrite a frozen milestone on commit — the same protected-value guard as bidMilestones.update', async () => {
    const caller = appRouter.createCaller({})
    await caller.bidMilestones.create({ bidId, milestoneType: 'queryDeadline', key: 'query1', label: 'Query 1' })
    await caller.protectedValues.freeze({ entityType: 'bid', entityId: bidId, fieldKey: 'query1' })
    await withClient(async (client) => {
      const rows = [row({ label: 'Query 1 (renamed)' })]
      const preview = await validateBidMilestoneRows(client, rows)
      expect(preview[0].action).toBe('update')
      await expect(commitBidMilestoneRows(client, rows, preview)).rejects.toMatchObject({ code: 'CONFLICT' })
    })
  })

  it('importing the submissionDeadline milestone mirrors it to the opportunity', async () => {
    await withClient(async (client) => {
      const rows = [row({ milestoneType: 'submissionDeadline', key: 'submissionDeadline', label: 'Submission Deadline', dueAt: '2099-03-01T00:00:00.000Z' })]
      const preview = await validateBidMilestoneRows(client, rows)
      expect(preview[0].action).toBe('update')
      await commitBidMilestoneRows(client, rows, preview)
    })
    expect((await pool.query('SELECT submission_date FROM opportunities WHERE id=$1', [opportunityId])).rows[0].submission_date).toBe('2099-03-01T00:00:00.000Z')
  })
})

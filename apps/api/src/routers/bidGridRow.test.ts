import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

// Task 28 prerequisites: the full Master Grid row shape (spec §8) — city,
// inheritance-aware owner, Solution Lead, documents, corrigendum status, next
// milestone, next action / Action Owner, updated-by.
describe('bids.listForGrid — full Master Grid row', () => {
  let departmentId: string
  let opportunityId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM ownership_assignments')
    await pool.query('DELETE FROM follow_ups')
    await pool.query('DELETE FROM documents')
    await pool.query('DELETE FROM bid_corrigendum_changes')
    await pool.query('DELETE FROM bid_corrigenda')
    await pool.query('DELETE FROM bid_custom_field_values')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    await pool.query('DELETE FROM sales_postings')
    await pool.query('DELETE FROM sales_persons')
    await pool.query(`DELETE FROM commercial_audit_logs WHERE entity_type = 'bid'`)
    const caller = appRouter.createCaller({})
    departmentId = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'DRDO' })).id
    opportunityId = (await caller.opportunities.create({ departmentId, opportunityName: 'AI Document Processing', submissionDate: '2026-10-10' })).id
  })

  const person = (c: any, name: string, email: string) =>
    c.sales.create({ name, officialEmail: email, designation: 'RM', tierKey: 'rm' }).then((p: any) => p.id as string)

  it('city round-trips through opportunities create/update/get and surfaces in the grid', async () => {
    const caller = appRouter.createCaller({})
    const created = await caller.opportunities.create({ departmentId, opportunityName: 'With City', city: 'Pune' })
    expect((await caller.opportunities.get({ id: created.id }))?.city).toBe('Pune')
    await caller.opportunities.update({ id: created.id, patch: { city: 'Nagpur' } })
    expect((await caller.opportunities.get({ id: created.id }))?.city).toBe('Nagpur')
    await caller.opportunities.update({ id: created.id, patch: { city: null } })
    expect((await caller.opportunities.get({ id: created.id }))?.city).toBeNull()
    await caller.opportunities.update({ id: opportunityId, patch: { city: 'New Delhi' } })
    const bid = await caller.bids.create({ opportunityId })
    const row = (await caller.bids.listForGrid({})).find((r: any) => r.id === bid.id)!
    expect(row.city).toBe('New Delhi')
    expect(row.departmentName).toBe('DRDO')
  })

  it('resolves ownerEmail through inheritance from the opportunity; a bid-level assignment overrides it, including for My Bids', async () => {
    const caller = appRouter.createCaller({ user: { email: 'inherited@amnex.com' } } as any)
    const bid = await caller.bids.create({ opportunityId })
    const inherited = await person(caller, 'Inherited Owner', 'inherited@amnex.com')
    await caller.ownership.assign({ entityType: 'opportunity', entityId: opportunityId, salesPersonId: inherited, startDate: '2026-01-01' })

    let grid = await caller.bids.listForGrid({})
    expect(grid.find((r: any) => r.id === bid.id)?.ownerEmail).toBe('inherited@amnex.com')
    let mine = await caller.bids.listForGrid({ filterRules: [{ field: 'ownerEmail', operator: 'eq', value: '$currentUser' }] })
    expect(mine.map((r: any) => r.id)).toContain(bid.id)

    const direct = await person(caller, 'Direct Owner', 'direct@amnex.com')
    await caller.ownership.assign({ entityType: 'bid', entityId: bid.id, salesPersonId: direct, startDate: '2026-02-01' })
    grid = await caller.bids.listForGrid({})
    expect(grid.find((r: any) => r.id === bid.id)?.ownerEmail).toBe('direct@amnex.com')
    mine = await caller.bids.listForGrid({ filterRules: [{ field: 'ownerEmail', operator: 'eq', value: '$currentUser' }] })
    expect(mine.map((r: any) => r.id)).not.toContain(bid.id)
  })

  it('surfaces documents, corrigendum status, next milestone, next action, action owner, solution lead and updated-by', async () => {
    const caller = appRouter.createCaller({ user: { email: 'editor@amnex.com' } } as any)
    const bid = await caller.bids.create({ opportunityId })
    await pool.query(
      `INSERT INTO documents (entity_type, entity_id, filename, storage_path, content_type, size_bytes) VALUES ('bid', $1, 'a.pdf', 'x/a.pdf', 'application/pdf', 10)`,
      [bid.id],
    )
    const actionOwner = await person(caller, 'Action Owner', 'action-owner@amnex.com')
    await caller.followUps.create({ entityType: 'bid', entityId: bid.id, dueDate: '2026-12-01', note: 'Confirm EMD instrument', assigneeId: actionOwner })
    const lead = await person(caller, 'Lead', 'lead@amnex.com')
    await caller.ownership.assign({ entityType: 'bid', entityId: bid.id, salesPersonId: lead, role: 'solutionLead', startDate: '2026-01-01' })
    await caller.bids.update({ id: bid.id, patch: { tenderLink: 'https://example.com' } })

    let row = (await caller.bids.listForGrid({})).find((r: any) => r.id === bid.id)!
    expect(row.documentCount).toBe(1)
    expect(row.latestCorrigendumStatus).toBeNull()
    expect(row.nextMilestoneLabel).toBe('Submission Deadline')
    expect(typeof row.daysRemaining).toBe('number')
    expect(row.nextActionNote).toBe('Confirm EMD instrument')
    expect(row.nextActionDueDate).toBe('2026-12-01')
    expect(row.nextActionAssigneeEmail).toBe('action-owner@amnex.com')
    expect(row.solutionLeadEmail).toBe('lead@amnex.com')
    expect(row.updatedBy).toBe('editor@amnex.com')

    await caller.bidCorrigenda.create({
      bidId: bid.id, corrigendumNumber: 1, changes: [{ fieldKey: 'tenderLink', currentValue: '', proposedValue: 'https://new' }],
    })
    row = (await caller.bids.listForGrid({})).find((r: any) => r.id === bid.id)!
    expect(row.latestCorrigendumStatus).toBe('pending_review')
  })

  it('bids.update writes one audit entry per patched field, attributed to the signed-in user', async () => {
    const caller = appRouter.createCaller({ user: { email: 'editor@amnex.com' } } as any)
    const bid = await caller.bids.create({ opportunityId })
    await caller.bids.update({ id: bid.id, patch: { tenderLink: 'https://example.com', stageKey: 'qualification' } })
    const logs = (await pool.query(`SELECT field, old_value, new_value, changed_by FROM commercial_audit_logs WHERE entity_type='bid' AND entity_id=$1 ORDER BY field`, [bid.id])).rows
    expect(logs).toEqual([
      { field: 'stageKey', old_value: 'solutioning', new_value: 'qualification', changed_by: 'editor@amnex.com' },
      { field: 'tenderLink', old_value: '', new_value: 'https://example.com', changed_by: 'editor@amnex.com' },
    ])
  })
})

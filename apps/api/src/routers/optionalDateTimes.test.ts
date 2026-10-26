import { describe, expect, it } from 'vitest'
import { appRouter } from '../index.js'

describe('Opportunity dates retain optional times through the API', () => {
  it('round-trips dates and explicit midnight in custom fields, lifecycle fields, next actions and corrigenda', async () => {
    const caller = appRouter.createCaller({ user: { email: 'calendar@example.com' } } as any)
    const department = await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Optional clock department' })
    const opportunity = await caller.opportunities.create({ departmentId: department.id, opportunityName: 'Optional clock verification', submissionDate: '2099-01-15' })
    const bid = await caller.bids.create({ opportunityId: opportunity.id })
    const field = await caller.bidCustomFields.create({ name: 'Optional clock test date', dataType: 'date' })
    for (const value of ['2026-10-09', '2026-10-09T15:45', '2026-10-09T00:00']) {
      await caller.bidCustomFields.setValue({ bidId: bid.id, fieldId: field.id, value })
      expect((await caller.bidCustomFields.valuesForBid({ bidId: bid.id })).optional_clock_test_date).toBe(value)
    }
    await caller.bids.update({ id: bid.id, patch: { lifecycleData: { expectedRfpDate: '2026-10-09T15:45' } } })
    expect((await caller.bids.get({ id: bid.id }))?.lifecycleData.expectedRfpDate).toBe('2026-10-09T15:45')
    const followUp = await caller.followUps.create({ entityType: 'bid', entityId: bid.id, note: 'Call client', dueDate: '2026-10-09T15:45' })
    expect((await caller.followUps.listForEntity({ entityType: 'bid', entityId: bid.id })).find(item => item.id === followUp.id)?.dueDate).toBe('2026-10-09T15:45')
    expect((await caller.bids.listForGrid({})).find(item => item.id === bid.id)?.nextActionDueDate).toBe('2026-10-09T15:45')
    const corrigendum = await caller.bidCorrigenda.create({ bidId: bid.id, corrigendumNumber: 1,
      register: { publishedDate: '2026-10-09T00:00', receivedDate: '2026-10-09T15:45', effectiveDate: '2026-10-10' },
      changes: [{ fieldKey: 'tenderLink', currentValue: '', proposedValue: 'https://example.com/tender' }],
    })
    const saved = (await caller.bidCorrigenda.listForBid({ bidId: bid.id })).find(item => item.id === corrigendum.id)
    expect(saved).toMatchObject({ publishedDate: '2026-10-09T00:00', receivedDate: '2026-10-09T15:45', effectiveDate: '2026-10-10' })
  })
})

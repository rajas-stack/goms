import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('bidSavedViews router', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM bid_saved_views')
  })

  it('always includes every system view, unconditionally', async () => {
    const caller = appRouter.createCaller({})
    const list = await caller.bidSavedViews.list()
    const keys = list.map((v: any) => v.key ?? v.id)
    expect(keys).toEqual(expect.arrayContaining(['allBids', 'myBids', 'solutioning', 'qualification', 'dueSoon', 'overdue', 'goApproved']))
    expect(list.filter((v: any) => v.isSystem)).toHaveLength(7)
  })

  it('never seeds "Smart Transport Bids" or "High Value Deals > 20 Cr" — they do not exist until created', async () => {
    const caller = appRouter.createCaller({})
    const list = await caller.bidSavedViews.list()
    expect(list.map((v: any) => v.name)).not.toContain('Smart Transport Bids')
    expect(list.map((v: any) => v.name)).not.toContain('High Value Deals > 20 Cr')
  })

  it('creates a personal view, invisible to a different user, and a global view visible to everyone', async () => {
    const asAlice = appRouter.createCaller({ user: { email: 'alice@amnex.com' } } as any)
    const asBob = appRouter.createCaller({ user: { email: 'bob@amnex.com' } } as any)
    await asAlice.bidSavedViews.create({ name: 'My Smart Transport Bids', scope: 'personal', filterRules: [{ field: 'vertical', operator: 'eq', value: 'Smart Transport' }] })
    const aliceList = await asAlice.bidSavedViews.list()
    const bobList = await asBob.bidSavedViews.list()
    expect(aliceList.map((v: any) => v.name)).toContain('My Smart Transport Bids')
    expect(bobList.map((v: any) => v.name)).not.toContain('My Smart Transport Bids')

    await asBob.bidSavedViews.create({ name: 'High Value Deals > 20 Cr', scope: 'global', filterRules: [] })
    const aliceListAfter = await asAlice.bidSavedViews.list()
    expect(aliceListAfter.map((v: any) => v.name)).toContain('High Value Deals > 20 Cr')
  })

  it('rejects updating or deleting a system view key', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.bidSavedViews.update({ id: 'allBids', patch: { name: 'Renamed' } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(caller.bidSavedViews.delete({ id: 'allBids' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('get() enforces the same scope=global OR ownerEmail=self rule as list() — a get on another user\'s personal view does not leak it', async () => {
    const asAlice = appRouter.createCaller({ user: { email: 'alice@amnex.com' } } as any)
    const asBob = appRouter.createCaller({ user: { email: 'bob@amnex.com' } } as any)
    const view = await asAlice.bidSavedViews.create({ name: 'Alice Only', scope: 'personal', filterRules: [] })
    const aliceGet = await asAlice.bidSavedViews.get({ id: view.id })
    expect(aliceGet?.name).toBe('Alice Only')
    const bobGet = await asBob.bidSavedViews.get({ id: view.id })
    expect(bobGet).toBeNull()
  })

  it('a view belongs to one Opportunity sheet (default Bid Tracker); system views are on every sheet', async () => {
    const caller = appRouter.createCaller({ user: { email: 'alice@amnex.com' } } as any)
    const tracker = await caller.bidSavedViews.create({ name: 'Tracker view', scope: 'personal' })
    const funnel = await caller.bidSavedViews.create({ name: 'Funnel view', scope: 'personal', sheet: 'pipeline-funnel' })
    expect(tracker.sheet).toBe('bidTracker')
    expect(funnel.sheet).toBe('pipeline-funnel')
    const list = await caller.bidSavedViews.list()
    expect(list.find((v: any) => v.id === funnel.id)?.sheet).toBe('pipeline-funnel')
    expect(list.filter((v: any) => v.isSystem).every((v: any) => v.sheet === 'all')).toBe(true)
  })
})

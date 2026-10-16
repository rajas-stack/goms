import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), list: vi.fn(), path: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: mocks.query } }))
vi.mock('./bids.js', async () => {
  const { router, publicProcedure } = await import('../trpc.js')
  return { bidsRouter: router({ listForGrid: publicProcedure.use(({ path, next }) => { mocks.path(path); return next() }).query(() => mocks.list()) }) }
})
import { insightsRouter, insightsFilterSchema, loadInsightRecords } from './insights.js'
import { opportunityPolicy } from '../auth/rbac/registry/opportunity.js'
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T00:00:00Z')); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('SECURITY_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('AUTH_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('READ_AUTH_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('RBAC_MODE', 'off'); vi.clearAllMocks() })
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
const row = { id: 'bid-visible', opportunityId: 'opp-visible', status: 'active', opportunityName: 'Real opportunity', departmentName: 'GIL', vertical: 'GIS', stateCode: 24, stageKey: 'submitted', sheet: 'bidTracker', attentionFlag: 'overdue', valueAmount: '50', valueUnit: 'lakh', preSalesPersonId: 'pre', bidTeamMemberId: 'bid-person', ownerEmail: 'owner@amnex.com', nextMilestoneDueAt: null, submissionDate: '2026-10-01' }
it('requires both analytics and opportunity-sheet read permissions', async () => {
  const checks = await Promise.all(opportunityPolicy['insights.dashboard'].requirements.map(requirement => requirement({}, {} as never)))
  expect(checks).toEqual([{ module: 'an.operational', action: 'read' }, { module: 'opp.bidTracker', action: 'read', anyOf: ['opp.bidTracker', 'opp.pipeline', 'opp.campaign'] }])
})
it('does not query enrichments when the authorized grid is empty', async () => {
  mocks.list.mockResolvedValue([]); expect(await loadInsightRecords({})).toEqual([]); expect(mocks.query).not.toHaveBeenCalled()
})
it('propagates a grid access denial before querying analytics data', async () => {
  mocks.list.mockRejectedValue(new Error('denied')); await expect(loadInsightRecords({})).rejects.toThrow('denied'); expect(mocks.query).not.toHaveBeenCalled()
})
it('joins only authorized identifiers, preserves attention flags and converts real INR units', async () => {
  mocks.list.mockResolvedValue([row, { ...row, id: 'archived', opportunityId: 'hidden-opp', status: 'archived' }])
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM opportunities') ? [{ id: 'opp-visible', stage_key: 'submitted', closed_on: null, currency: 'INR', created_at: new Date('2026-10-01T00:00:00Z') }] : sql.includes('FROM sales_persons') ? [{ id: 'pre', name: 'Presales owner' }] : [] }))
  const result = await insightsRouter.createCaller({}).dashboard({ months: 12 })
  expect(result.records).toHaveLength(1); expect(result.records[0]).toMatchObject({ valueCr: .5, attentionFlag: 'overdue', presales: 'Presales owner', team: 'Unassigned' })
  expect(mocks.path).toHaveBeenCalledWith('bids.listForGrid')
  expect(mocks.query.mock.calls[0][1]).toEqual([['opp-visible']]); expect(mocks.query.mock.calls[2][1]).toEqual([['bid-visible']])
  expect(JSON.stringify(mocks.query.mock.calls)).not.toContain('hidden-opp')
})
it('rejects unbounded periods and oversized filter values', () => {
  expect(insightsFilterSchema.safeParse({ months: -1000 }).success).toBe(false)
  expect(insightsFilterSchema.safeParse({ months: 12, stateCode: -1 }).success).toBe(false)
  expect(insightsFilterSchema.safeParse({ months: 12, search: 'x'.repeat(201) }).success).toBe(false)
})

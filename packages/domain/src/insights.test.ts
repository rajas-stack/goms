import { describe, expect, it } from 'vitest'
import { competitionNames, computeInsights, insightValueCr, type InsightRecord } from './insights.js'

const record = (id: string, patch: Partial<InsightRecord> = {}): InsightRecord => ({ id, opportunityId: `opp-${id}`, name: id, department: 'IT', vertical: 'GIS', stateCode: 24,
  stageKey: 'solutioning', opportunityStageKey: 'qualified', sheet: 'bidTracker', status: 'active', attentionFlag: 'onTrack', createdAt: '2026-08-01T00:00:00Z', closedOn: null, dueAt: '2026-12-01', valueCr: 10,
  owner: 'Sales', presales: 'Presales', team: 'Bid', competitors: [], ...patch })
const compute = (rows: InsightRecord[], filters = { months: 12 }) => computeInsights(rows, filters, '2026-10-15')
describe('Insights financial facts and cohorts', () => {
  it.each([['2', 'cr', 2], ['50', 'lakh', .5], ['1,000', 'thousand', .1], ['10000000', 'rupee', 1]])('converts %s %s to INR crore', (amount, unit, expected) => expect(insightValueCr(amount, unit)).toBe(expected))
  it.each([['', 'cr', 'INR'], ['bad', 'cr', 'INR'], ['-2', 'cr', 'INR'], ['4', 'unknown', 'INR'], ['2', 'cr', 'USD']])('does not invent a price or exchange rate for %s %s %s', (amount, unit, currency) => expect(insightValueCr(amount, unit, currency)).toBeNull())
  it('uses stored stage probabilities, not invented bid stage weights', () => {
    const data = compute([record('a'), record('b', { valueCr: 20, opportunityStageKey: 'submitted' })])
    expect(data.metrics.pipeline).toBe(30); expect(data.metrics.weighted).toBe(13); expect(data.metrics.active).toBe(2)
    expect(data.metrics.winRate).toBeNull()
  })
  it('does not equate go-approved with a won outcome when opportunity data is not won', () => {
    const data = compute([record('go', { stageKey: 'goApproved' }), record('won', { stageKey: 'goApproved', opportunityStageKey: 'won', valueCr: 5 }), record('lost', { opportunityStageKey: 'lost' }), record('drop', { stageKey: 'dropped', opportunityStageKey: 'dropped' })])
    expect(data.metrics.active).toBe(0); expect(data.metrics.wonValue).toBe(5); expect(data.metrics.winRate).toBe(50)
  })
  it('excludes archived/future records and duplicate opportunity financial facts', () => {
    const data = compute([record('a'), record('duplicate', { opportunityId: 'opp-a' }), record('archived', { status: 'archived' }), record('future', { createdAt: '2027-01-01' })])
    expect(data.records).toHaveLength(1); expect(data.metrics.pipeline).toBe(10)
  })
  it('applies state 0, vertical and search filters without treating Central Ministries as all states', () => {
    const data = computeInsights([record('central', { stateCode: 0 }), record('gujarat')], { months: 12, stateCode: 0, vertical: 'GIS', search: 'CENTRAL' }, '2026-10-15')
    expect(data.records.map(r => r.id)).toEqual(['central']); expect(data.options.states).toEqual([0, 24])
  })
  it('compares creation cohorts and never labels current data as historical snapshots', () => {
    const data = compute([record('current'), record('prior', { createdAt: '2025-05-01', valueCr: 5 }), record('old', { createdAt: '2020-01-01' })])
    expect(data.start).toBe('2025-11-01'); expect(data.metrics.pipeline).toBe(10); expect(data.previous?.pipeline).toBe(5)
  })
  it('uses exactly the grid attention flags and excludes closed bids from at-risk pipeline', () => {
    const data = compute([record('overdue', { attentionFlag: 'overdue' }), record('soon', { attentionFlag: 'dueSoon' }), record('review', { attentionFlag: 'corrigendumPending' }), record('won', { attentionFlag: 'overdue', opportunityStageKey: 'won' })])
    expect(data.metrics.atRisk).toBe(3); expect(data.metrics.atRiskValue).toBe(30); expect(data.records[0].attentionFlag).toBe('overdue')
  })
  it('keeps zero-valued and unpriced opportunities in counts without corrupting money totals', () => {
    const data = compute([record('unknown', { valueCr: null }), record('zero', { valueCr: 0 })])
    expect(data.metrics.active).toBe(2); expect(data.metrics.pipeline).toBe(0); expect(data.metrics.unpriced).toBe(1)
  })
  it('plots closure events for older opportunities and provides their drill-through records', () => {
    const data = compute([record('old-win', { createdAt: '2020-01-01', opportunityStageKey: 'won', closedOn: '2026-10-01', valueCr: 15 })])
    expect(data.records).toHaveLength(0); expect(data.eventRecords).toHaveLength(1)
    expect(data.trend.at(-1)?.wonValue).toBe(15); expect(data.trend.at(-1)?.count).toBe(0)
  })
  it('returns a finite, empty dashboard and no fictional baseline in all-time mode', () => {
    const data = compute([], { months: 0 }); expect(data.metrics.pipeline).toBe(0); expect(data.metrics.winRate).toBeNull(); expect(data.previous).toBeNull(); expect(data.trend).toHaveLength(1)
  })
  it('groups actual ownership, forecast due quarters and competitor exposure with record ids', () => {
    const data = compute([record('a', { competitors: ['Rival'] }), record('b', { dueAt: null })])
    expect(data.forecast.map(g => g.key).sort()).toEqual(['2026 Q4', 'Unscheduled'])
    expect(data.competitors[0]).toMatchObject({ key: 'Rival', count: 1, ids: ['a'] }); expect(data.presales[0].count).toBe(2)
  })
  it('extracts only entered competitor names, not scores or default blank rows', () => {
    expect(competitionNames({ type: 'doc', content: [{ type: 'grid', attrs: { grid: { columns: [{ id: 'c', name: 'Competitor' }, { id: 's', name: 'Technical score' }], rows: [{ cells: { c: ' Rival ', s: 99 } }, { cells: { c: '' } }, { cells: { c: 'Rival' } }] } } }] })).toEqual(['Rival'])
  })
})

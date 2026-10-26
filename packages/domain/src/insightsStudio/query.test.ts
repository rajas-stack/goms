import { describe, expect, it } from 'vitest'
import { runQuery, measureKey, labelKeyOf } from './query.js'
import { COUNT_FIELD, type DataRow, type QuerySpec } from './types.js'

const TODAY = '2026-10-15'
const opp = (over: Partial<Record<string, string | number | null>>): DataRow => ({
  id: 'x', opportunityId: 'o', opportunityCode: '', name: 'Opp', department: 'GIL', state: 'Gujarat', city: '', vertical: 'GIS', opportunityType: 'RFP',
  pipelineStage: 'pipeline', bidStage: 'solutioning', decision: 'pending', status: 'active', attention: 'onTrack', owner: 'a@amnex.com',
  presales: 'P', bidTeam: 'B', createdAt: '2026-05-10', publishDate: '', submissionDate: '2026-11-01', closedOn: null, nextMilestoneDueAt: null,
  documentCount: 0, valueAmount: '10', valueUnit: 'cr', currency: 'INR', ...over,
})
const rows: DataRow[] = [
  opp({ id: '1', vertical: 'GIS', valueAmount: '10', createdAt: '2026-04-02' }),
  opp({ id: '2', vertical: 'GIS', valueAmount: '50', valueUnit: 'lakh', createdAt: '2026-04-20' }),
  opp({ id: '3', vertical: 'Data & AI', valueAmount: '5', createdAt: '2026-09-30', pipelineStage: 'won', closedOn: '2026-09-30' }),
  opp({ id: '4', vertical: 'Data & AI', valueAmount: '7', createdAt: '2026-10-01', pipelineStage: 'lost', closedOn: '2026-10-05' }),
  opp({ id: '5', vertical: '', valueAmount: 'n/a', createdAt: '2026-03-31', submissionDate: '2026-10-01' }),
]
const spec = (over: Partial<QuerySpec>): QuerySpec => ({ datasetId: 'opportunities.master', dimensions: [], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [], ...over })
const run = (over: Partial<QuerySpec>, data = rows) => runQuery(data, spec(over), { today: TODAY })

describe('runQuery', () => {
  it('counts and sums derived INR crore values, skipping unusable values', () => {
    const result = run({ measures: [{ field: COUNT_FIELD, agg: 'count' }, { field: 'valueCr', agg: 'sum' }, { field: 'valueCr', agg: 'avg' }] })
    expect(result.rows).toEqual([{ count: 5, sum_valueCr: 22.5, avg_valueCr: 22.5 / 4 }])
    expect(result.columns.map((c) => c.key)).toEqual(['count', 'sum_valueCr', 'avg_valueCr'])
  })

  it('returns one zero row for a KPI over no rows', () => {
    expect(run({ measures: [{ field: 'valueCr', agg: 'sum' }] }, []).rows).toEqual([{ sum_valueCr: 0 }])
  })

  it('groups by a dimension, labelling blanks and sorting by the measure', () => {
    const { rows: out } = run({ dimensions: [{ field: 'vertical' }] })
    expect(out.map((r) => [r.vertical, r[labelKeyOf('vertical')], r.count])).toEqual([['GIS', 'GIS', 2], ['Data & AI', 'Data & AI', 2], ['', 'Not set', 1]])
  })

  it('buckets dates by Indian FY quarter and half by default (Apr–Mar)', () => {
    const quarters = run({ dimensions: [{ field: 'createdAt', grain: 'quarter' }] }).rows
    expect(quarters.map((r) => [r.createdAt, r[labelKeyOf('createdAt')], r.count])).toEqual([
      ['FY2026-Q4', 'Q4 FY26', 1], ['FY2027-Q1', 'Q1 FY27', 2], ['FY2027-Q2', 'Q2 FY27', 1], ['FY2027-Q3', 'Q3 FY27', 1],
    ])
    const halves = run({ dimensions: [{ field: 'createdAt', grain: 'half' }] }).rows
    expect(halves.map((r) => [r[labelKeyOf('createdAt')], r.count])).toEqual([['H2 FY26', 1], ['H1 FY27', 3], ['H2 FY27', 1]])
  })

  it('switches to calendar halves when asked', () => {
    const halves = run({ calendar: 'calendar', dimensions: [{ field: 'createdAt', grain: 'half' }] }).rows
    expect(halves.map((r) => [r[labelKeyOf('createdAt')], r.count])).toEqual([['H1 2026', 3], ['H2 2026', 2]])
  })

  it('orders enum dimensions by their declared order (stage flow)', () => {
    const { rows: out } = run({ dimensions: [{ field: 'pipelineStage' }] })
    expect(out.map((r) => r.pipelineStage)).toEqual(['pipeline', 'won', 'lost'])
  })

  it('applies filters: between dates, in, boolean derived fields', () => {
    expect(run({ filters: [{ field: 'createdAt', op: 'between', value: ['2026-04-01', '2026-09-30'] }] }).rows[0].count).toBe(3)
    expect(run({ filters: [{ field: 'pipelineStage', op: 'in', value: ['won', 'lost'] }] }).rows[0].count).toBe(2)
    expect(run({ filters: [{ field: 'isOpen', op: 'isTrue' }] }).rows[0].count).toBe(3)
    expect(run({ filters: [{ field: 'isOverdue', op: 'isTrue' }] }).rows[0].count).toBe(1)
    expect(run({ filters: [{ field: 'vertical', op: 'empty' }] }).rows[0].count).toBe(1)
    expect(run({ filters: [{ field: 'name', op: 'contains', value: 'OPP' }] }).rows[0].count).toBe(5)
  })

  it('computes a win rate as the average of a boolean', () => {
    const result = run({ measures: [{ field: 'isWon', agg: 'avg', format: 'percent' }], filters: [{ field: 'pipelineStage', op: 'in', value: ['won', 'lost'] }] })
    expect(result.rows[0][measureKey({ field: 'isWon', agg: 'avg' })]).toBe(0.5)
  })

  it('supports distinct, min, max, explicit sort and limit', () => {
    const result = run({ dimensions: [{ field: 'vertical' }], measures: [{ field: 'department', agg: 'distinct' }, { field: 'createdAt', agg: 'max' }], sort: { by: 'vertical', dir: 'asc' }, limit: 2 })
    expect(result.rows.map((r) => [r.vertical, r.distinct_department, r.max_createdAt])).toEqual([['Data & AI', 1, '2026-10-01'], ['GIS', 1, '2026-04-20']])
    expect(result.groups).toBe(3)
  })

  it('groups by two dimensions', () => {
    const result = run({ dimensions: [{ field: 'vertical' }, { field: 'pipelineStage' }] })
    expect(result.rows).toHaveLength(4)
  })

  it('refuses a field that belongs to another source (lineage)', () => {
    expect(() => run({ datasetId: 'opportunities.bidTracker', dimensions: [{ field: 'sheet' }] })).toThrow(/not a field of Live Bids/)
    expect(() => run({ datasetId: 'employees', dimensions: [{ field: 'vertical' }] })).toThrow(/not a field of Employees/)
    expect(() => run({ datasetId: 'nope' })).toThrow(/Unknown data source/)
  })
})

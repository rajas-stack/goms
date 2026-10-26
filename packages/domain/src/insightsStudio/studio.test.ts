import { describe, expect, it } from 'vitest'
import { DATASETS, datasetsByModule, getDataset, readableDatasets } from './catalog.js'
import { compatibleCharts, defaultAggregation, defaultMeasure, recommendChart, suggestGrain } from './recommend.js'
import { effectiveQuery, previousQuery } from './reportQuery.js'
import { BUILT_IN_VISUALS, builtInReports, isKnownBuiltInVisual } from './templates.js'
import { bucketOf, currentPeriod, fiscalYear, periodLabel, periodRange, previousRange } from './time.js'
import { assertValidVisualSpec, normalizeReportInput, normalizeVisualInput } from './validate.js'
import { COUNT_FIELD, REPORT_GRID_COLUMNS, type QuerySpec, type ReportWidget } from './types.js'

describe('time', () => {
  it('names Indian financial years by the year they end in', () => {
    expect(fiscalYear('2026-03-31')).toBe(2026)
    expect(fiscalYear('2026-04-01')).toBe(2027)
    expect(bucketOf('2026-04-01', 'half')).toEqual({ key: 'FY2027-H1', label: 'H1 FY27' })
    expect(bucketOf('2027-01-15', 'quarter')).toEqual({ key: 'FY2027-Q4', label: 'Q4 FY27' })
    expect(bucketOf('2027-01-15T10:00:00Z', 'month')).toEqual({ key: '2027-01', label: 'Jan 2027' })
    expect(bucketOf('not a date', 'month')).toBeNull()
  })

  it('turns report periods into date ranges and finds the previous period', () => {
    expect(periodRange({ kind: 'half', fy: 2027, half: 1 })).toEqual({ from: '2026-04-01', to: '2026-09-30' })
    expect(periodRange({ kind: 'half', fy: 2027, half: 2 })).toEqual({ from: '2026-10-01', to: '2027-03-31' })
    expect(periodRange({ kind: 'quarter', fy: 2027, quarter: 4 })).toEqual({ from: '2027-01-01', to: '2027-03-31' })
    expect(periodRange({ kind: 'fy', fy: 2026 }, 'calendar')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(periodRange({ kind: 'all' })).toBeNull()
    expect(previousRange({ from: '2026-04-01', to: '2026-09-30' })).toEqual({ from: '2025-10-01', to: '2026-03-31' })
    expect(previousRange({ from: '2026-10-10', to: '2026-10-19' })).toEqual({ from: '2026-09-30', to: '2026-10-09' })
    expect(currentPeriod('2026-10-15')).toEqual({ fy: 2027, half: 2, quarter: 3 })
    expect(periodLabel({ kind: 'half', fy: 2027, half: 1 })).toBe('H1 FY27')
  })
})

describe('catalog integrity', () => {
  it('has unique source ids, unique field keys per source and valid default measures / time fields', () => {
    expect(new Set(DATASETS.map((d) => d.id)).size).toBe(DATASETS.length)
    for (const d of DATASETS) {
      const keys = d.fields.map((f) => f.key)
      expect(new Set(keys).size, d.id).toBe(keys.length)
      expect(d.defaultMeasure === COUNT_FIELD || keys.includes(d.defaultMeasure), d.id).toBe(true)
      if (d.timeField) expect(d.fields.find((f) => f.key === d.timeField)?.type, d.id).toBe('date')
      expect(d.rbacModules.length, d.id).toBeGreaterThan(0)
    }
  })

  it('declares one opportunity source per sheet and never exposes tender website addresses or credentials', () => {
    expect(DATASETS.filter((d) => d.id.startsWith('opportunities.')).map((d) => d.label)).toEqual([
      'Live Bids', 'Pipeline · Funnel', 'Pipeline · Backup', 'Pipeline · Commits', 'Campaign', 'Master (all sheets)',
    ])
    const keys = getDataset('tenderWebsites')!.fields.map((f) => f.key)
    expect(keys.some((k) => /url|credential|password|ciphertext/i.test(k) && k !== 'hasCredentials')).toBe(false)
  })

  it('offers valid suggestions for every source', () => {
    for (const d of DATASETS) for (const s of d.suggestions ?? []) {
      expect(s.spec.query.datasetId, `${d.id}: ${s.name}`).toBe(d.id)
      expect(() => assertValidVisualSpec(s.spec), `${d.id}: ${s.name}`).not.toThrow()
    }
  })

  it('hides sources the reader cannot read and groups the rest by module', () => {
    const readable = readableDatasets((m) => m === 'team.org')
    expect(readable.map((d) => d.id)).toEqual(['employees'])
    expect(datasetsByModule(DATASETS)[0].module).toBe('Opportunity')
  })
})

const q = (over: Partial<QuerySpec>): QuerySpec => ({ datasetId: 'opportunities.master', dimensions: [], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [], ...over })

describe('recommendations', () => {
  it('picks the best-fit chart for each query shape', () => {
    expect(recommendChart(q({})).chart).toBe('kpi')
    expect(recommendChart(q({ dimensions: [{ field: 'createdAt', grain: 'month' }] })).chart).toBe('line')
    expect(recommendChart(q({ dimensions: [{ field: 'createdAt', grain: 'quarter' }] })).chart).toBe('column')
    expect(recommendChart(q({ dimensions: [{ field: 'pipelineStage' }] })).chart).toBe('funnel')
    expect(recommendChart(q({ dimensions: [{ field: 'vertical' }] }), () => 5).chart).toBe('donut')
    expect(recommendChart(q({ dimensions: [{ field: 'department' }] }), () => 40).chart).toBe('bar')
    expect(recommendChart(q({ dimensions: [{ field: 'vertical' }, { field: 'createdAt', grain: 'month' }] })).chart).toBe('stackedBar')
    expect(recommendChart(q({ dimensions: [{ field: 'department' }, { field: 'owner' }] }), () => 20).chart).toBe('heatmap')
    expect(recommendChart(q({ dimensions: [{ field: 'vertical' }, { field: 'owner' }, { field: 'state' }] })).chart).toBe('table')
    expect(compatibleCharts(q({}))).toEqual(['kpi', 'table'])
  })

  it('chooses sensible default aggregations and grains', () => {
    const master = getDataset('opportunities.master')!
    expect(defaultMeasure(master)).toEqual({ field: 'valueCr', agg: 'sum', format: 'currency' })
    expect(defaultMeasure(getDataset('employees')!)).toEqual({ field: COUNT_FIELD, agg: 'count' })
    expect(defaultAggregation(master.fields.find((f) => f.key === 'ageDays')!)).toBe('avg')
    expect(defaultAggregation(master.fields.find((f) => f.key === 'department')!)).toBe('distinct')
    expect(suggestGrain([{ d: '2026-01-01' }, { d: '2026-01-20' }], 'd')).toBe('day')
    expect(suggestGrain([{ d: '2025-01-01' }, { d: '2026-01-20' }], 'd')).toBe('month')
    expect(suggestGrain([{ d: '2021-01-01' }, { d: '2026-01-20' }], 'd')).toBe('quarter')
  })
})

describe('validation', () => {
  it('rejects unknown sources, foreign fields and impossible aggregations', () => {
    expect(() => assertValidVisualSpec({ chart: 'kpi', query: q({ datasetId: 'x' }) })).toThrow(/Unknown data source/)
    expect(() => assertValidVisualSpec({ chart: 'bar', query: q({ datasetId: 'opportunities.campaign', dimensions: [{ field: 'sheet' }] }) })).toThrow(/not a field of Campaign/)
    expect(() => assertValidVisualSpec({ chart: 'kpi', query: q({ measures: [{ field: 'vertical', agg: 'sum' }] }) })).toThrow(/cannot be aggregated/)
    expect(() => assertValidVisualSpec({ chart: 'line', query: q({ dimensions: [{ field: 'vertical', grain: 'month' }] }) })).toThrow(/cannot be grouped by time/)
    expect(() => normalizeVisualInput({ name: '  ', spec: { chart: 'kpi', query: q({}) } })).toThrow(/Name is required/)
    expect(normalizeVisualInput({ name: ' Pipeline ', spec: { chart: 'kpi', query: q({}) } }).name).toBe('Pipeline')
  })

  it('validates report widgets against the grid and existing visuals', () => {
    const widget: ReportWidget = { id: 'w1', kind: 'visual', visualId: 'v-1', x: 0, y: 0, w: 6, h: 4 }
    const filters = { period: { kind: 'half' as const, fy: 2027, half: 1 as const } }
    expect(normalizeReportInput({ name: 'H1', widgets: [widget], filters }, (id) => id === 'v-1').widgets).toHaveLength(1)
    expect(() => normalizeReportInput({ name: 'H1', widgets: [widget], filters }, () => false)).toThrow(/does not exist/)
    expect(() => normalizeReportInput({ name: 'H1', widgets: [{ ...widget, x: 8 }], filters }, () => true)).toThrow(/12-column/)
  })
})

describe('built-in templates', () => {
  it('ships valid built-in visuals and reports whose widgets fit the grid without overlapping', () => {
    for (const v of BUILT_IN_VISUALS) expect(() => assertValidVisualSpec(v.spec), v.id).not.toThrow()
    const reports = builtInReports('2026-10-15')
    expect(reports.map((r) => r.name)).toEqual(['H1 Review', 'Quarterly Review', 'Bid Health', 'Team Performance'])
    for (const r of reports) {
      expect(() => normalizeReportInput(r, () => false), r.name).not.toThrow()
      const cells = new Set<string>()
      for (const w of r.widgets) {
        if (w.visualId) expect(isKnownBuiltInVisual(w.visualId)).toBe(true)
        expect(w.x + w.w).toBeLessThanOrEqual(REPORT_GRID_COLUMNS)
        for (let x = w.x; x < w.x + w.w; x++) for (let y = w.y; y < w.y + w.h; y++) {
          expect(cells.has(`${x},${y}`), `${r.name} overlap at ${x},${y}`).toBe(false)
          cells.add(`${x},${y}`)
        }
      }
    }
    expect(reports[0].filters.period).toEqual({ kind: 'half', fy: 2027, half: 1 })
  })

  it('applies the report period to each visual’s own date and skips live views', () => {
    const filters = { period: { kind: 'half' as const, fy: 2027, half: 1 as const }, vertical: 'GIS' }
    const due = BUILT_IN_VISUALS.find((v) => v.id === 'builtin:orders-due-value')!
    const live = BUILT_IN_VISUALS.find((v) => v.id === 'builtin:live-bids-by-stage')!
    expect(effectiveQuery(due.spec, filters).query.filters).toContainEqual({ field: 'submissionDate', op: 'between', value: ['2026-04-01', '2026-09-30'] })
    expect(effectiveQuery(due.spec, filters).applied).toEqual(['period', 'vertical'])
    expect(effectiveQuery(live.spec, filters).applied).toEqual(['vertical'])
    expect(previousQuery(due.spec, filters)!.filters).toContainEqual({ field: 'submissionDate', op: 'between', value: ['2025-10-01', '2026-03-31'] })
    const employees = BUILT_IN_VISUALS.find((v) => v.id === 'builtin:employees-by-team')!
    expect(effectiveQuery(employees.spec, filters).applied).toEqual([])
  })
})

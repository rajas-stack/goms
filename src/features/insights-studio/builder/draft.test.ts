import { describe, expect, it } from 'vitest'
import { addMeasure, chooseChart, draftForSource, setDimension, setMeasureAgg, setMeasureField, suggestName } from './draft'

const rows = [{ createdAt: '2025-01-01', vertical: 'GIS' }, { createdAt: '2026-06-01', vertical: 'AI' }]

describe('visual builder draft', () => {
  it('starts a source with its natural measure as a KPI', () => {
    const d = draftForSource('opportunities.bidTracker')
    expect(d.spec.query.measures).toEqual([{ field: 'valueCr', agg: 'sum', format: 'currency' }])
    expect(d.spec.chart).toBe('kpi')
    expect(() => draftForSource('nope')).toThrow()
  })

  it('suggests a time grain for dates and follows the chart recommendation until the user picks one', () => {
    const trend = setDimension(draftForSource('opportunities.bidTracker'), 0, 'createdAt', rows)
    expect(trend.spec.query.dimensions).toEqual([{ field: 'createdAt', grain: 'month' }])
    expect(trend.spec.chart).toBe('line')
    const picked = chooseChart(trend, 'column')
    expect(setDimension(picked, 1, 'vertical', rows).spec.chart).toBe('stackedBar')
    const cleared = setDimension(trend, 0, '', rows)
    expect(cleared.spec.query.dimensions).toEqual([])
    expect(cleared.spec.chart).toBe('kpi')
  })

  it('picks sensible aggregations and formats', () => {
    let d = setMeasureField(draftForSource('opportunities.master'), 0, 'isWon')
    expect(d.spec.query.measures[0]).toEqual({ field: 'isWon', agg: 'avg', format: 'percent' })
    d = setMeasureAgg(d, 0, 'count')
    expect(d.spec.query.measures[0]).toEqual({ field: 'isWon', agg: 'count' })
    expect(addMeasure(d).spec.query.measures).toHaveLength(2)
    expect(suggestName(setDimension(draftForSource('employees'), 0, 'team').spec)).toBe('Employees records by Team')
  })
})

import { describe, expect, it } from 'vitest'
import { BID_STAGES, computeInsights } from '@goms/domain'
import { createInsightDemoRecords } from './demoData'

describe('Insights read-only demo', () => {
  const today = '2026-10-15'
  it('covers stages, statuses, geography, competition and every monthly trend', () => {
    const rows = createInsightDemoRecords(today), data = computeInsights(rows, { months: 12 }, today)
    expect(rows).toEqual(createInsightDemoRecords(today))
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length)
    expect(rows.every(r => r.id.startsWith('insights-demo-') && r.createdAt <= today)).toBe(true)
    expect(data.stages.map(g => g.key)).toEqual(BID_STAGES.map(s => s.key))
    expect(data.attention).toHaveLength(4)
    for (const groups of [data.verticals, data.departments, data.states, data.owners, data.presales, data.team, data.competitors, data.forecast]) expect(groups.length).toBeGreaterThan(2)
    expect(data.trend.every(t => t.count > 0)).toBe(true)
    expect(data.trend.some(t => t.wonCount > 0 && t.lostCount > 0)).toBe(true)
    expect(data.previous?.pipeline).toBeGreaterThan(0)
    expect(data.metrics.wonValue).toBeGreaterThan(0)
    expect(data.metrics.atRisk).toBeGreaterThan(0)
    expect(data.forecast.some(g => g.key === 'Unscheduled')).toBe(true)
  })
  it('uses the normal filters and remains populated at the start of a year/month', () => {
    for (const date of ['2027-01-01', '2028-02-29']) {
      const rows = createInsightDemoRecords(date)
      expect(rows.every(r => r.createdAt <= date && (!r.closedOn || r.closedOn <= date))).toBe(true)
      const filtered = computeInsights(rows, { months: 6, stateCode: 24, search: 'AI Sangrah' }, date)
      expect(filtered.records).toHaveLength(1)
      expect(filtered.records[0].valueCr).toBe(70)
    }
  })
})

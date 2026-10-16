import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartMaterial } from './ChartMaterial'
import { DonutChart, Sparkline, TrendChart } from './InsightCharts'
import type { InsightTrend } from '@goms/domain'

describe('Color-independent chart material', () => {
  it('keeps series colors while sharing cap, body, reflection and fade definitions', () => {
    const { container } = render(<svg><ChartMaterial id="teal" color="#33b7a2"/><ChartMaterial id="amber" color="#e6a237"/></svg>)
    expect(container.querySelectorAll('linearGradient')).toHaveLength(6)
    for (const id of ['teal', 'amber']) {
      expect(container.querySelector(`#${id}-surface .insight-material-cap`)).not.toBeNull()
      expect(container.querySelector(`#${id}-surface .insight-material-base`)).not.toBeNull()
      expect(container.querySelector(`#${id}-sheen`)).not.toBeNull()
      expect(container.querySelector(`#${id}-area`)).not.toBeNull()
    }
    expect(container.querySelector('#teal-surface')?.getAttribute('style')).not.toBe(container.querySelector('#amber-surface')?.getAttribute('style'))
  })
  it('uses unique resolved paint references in donuts, lines and sparklines without replacing hit targets', () => {
    const groups = [{ key: 'a', label: 'Data', value: 70, count: 4, ids: ['a'] }]
    const trend = [{ key: '2026-10-01', label: 'Oct', value: 70, count: 4, wonValue: 5, wonCount: 1, lostValue: 0, lostCount: 0 }] as InsightTrend[]
    const { container } = render(<><DonutChart groups={groups} onPick={() => {}}/><TrendChart data={trend} count={false} onPick={() => {}}/><Sparkline values={[1, 2]}/></>)
    const ids = [...container.querySelectorAll('[id]')].map(el => el.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const el of container.querySelectorAll('[fill^="url("], [stroke^="url("]')) {
      const paint = el.getAttribute('fill')?.startsWith('url(') ? el.getAttribute('fill')! : el.getAttribute('stroke')!
      expect(ids).toContain(paint.slice(5, -1))
    }
    expect(container.querySelector('.insight-hit')).not.toBeNull()
    expect(container.querySelectorAll('.insight-material-reflection').length).toBeGreaterThan(3)
  })
})

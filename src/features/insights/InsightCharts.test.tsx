import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StageChart } from './InsightCharts'

describe('Stage chart reference styling and truthful values', () => {
  const groups = [
    { key: 'solutioning', label: 'Solutioning', value: 70, count: 30, ids: ['a'] },
    { key: 'submitted', label: 'Submitted', value: 58, count: 24, ids: ['b'] },
  ]
  it('renders paired gradient columns with value labels and independent integer count ticks', () => {
    const { container } = render(<StageChart groups={groups} showValue showCount onPick={() => {}}/>)
    expect(screen.getByText('\u20b970 Cr')).toBeVisible(); expect(screen.getByText('\u20b958 Cr')).toBeVisible()
    expect(container.querySelectorAll('linearGradient')).toHaveLength(3)
    expect(container.querySelectorAll('path[data-series=value]')).toHaveLength(2)
    expect(container.querySelectorAll('path[data-series=count]')).toHaveLength(2)
    const ticks = [...container.querySelectorAll('.insight-stage-count-tick')].map(el => Number(el.textContent))
    expect(ticks.every(Number.isInteger)).toBe(true); expect(new Set(ticks).size).toBe(ticks.length)
    expect(container.querySelectorAll('.insight-stage-grid-vertical')).toHaveLength(3)
  })
  it('distinguishes an unpriced stage from a recorded zero value', () => {
    const row = [{ ...groups[0], value: 0, count: 1 }]
    const { container, rerender } = render(<StageChart groups={row} showValue showCount valueStages={new Set()} onPick={() => {}}/>)
    expect(screen.getByText('Not recorded')).toBeVisible()
    expect(container.querySelector('path[data-series=value]')).toBeNull()
    expect(container.querySelector('path[data-series=count]')).not.toBeNull()
    expect(container.querySelectorAll('.insight-stage-axis:not(.insight-stage-count-tick)')).toHaveLength(0)
    rerender(<StageChart groups={row} showValue showCount valueStages={new Set(['solutioning'])} onPick={() => {}}/>)
    expect(screen.getByText('\u20b90 Cr')).toBeVisible()
  })
  it('preserves click and keyboard source-record navigation', () => {
    const pick = vi.fn()
    render(<StageChart groups={groups} showValue showCount onPick={pick}/>)
    const mark = screen.getByRole('button', { name: /^Solutioning:/ })
    fireEvent.click(mark); fireEvent.keyDown(mark, { key: 'Enter' }); fireEvent.keyDown(mark, { key: ' ' })
    expect(pick).toHaveBeenCalledTimes(3); expect(pick).toHaveBeenLastCalledWith(groups[0])
  })
})

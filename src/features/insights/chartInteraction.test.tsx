import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Bars, DonutChart, Frame, IndiaMap, Sparkline, StageChart, TrendChart } from './InsightCharts'
import type { InsightTrend } from '@goms/domain'
import { Bar, Donut } from '@/app/routes/InsightsPrimitives'

const groups = [
  { key: '24', label: 'Gujarat', value: 70, count: 30, ids: ['a'] },
  { key: '27', label: 'Maharashtra', value: 58, count: 24, ids: ['b'] },
]
describe('Chart contextual interaction', () => {
  it('shows exact stage details for pointer and focus, mutes siblings, and dismisses on Escape', async () => {
    render(<Frame title="Stages"><StageChart groups={groups} showValue showCount onPick={() => {}}/></Frame>)
    const mark = screen.getByRole('button', { name: /^Gujarat:/ })
    fireEvent.pointerEnter(mark.querySelector('[data-series=value]')!, { pointerType: 'mouse' })
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('70', { exact: false })).toBeVisible())
    expect(mark).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    expect(screen.getByRole('button', { name: /^Maharashtra:/ })).toHaveAttribute('data-chart-muted', 'true')
    fireEvent.pointerLeave(mark.querySelector('[data-series=value]')!)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(mark); await waitFor(() => expect(screen.getByRole('tooltip')).toBeVisible())
    fireEvent.keyUp(mark, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('horizontal bars preserve keyboard drill and expose value plus count', async () => {
    const pick = vi.fn()
    render(<Bars groups={groups} onPick={pick}/>)
    const row = screen.getByRole('button', { name: /Gujarat/ })
    fireEvent.focus(row)
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('30')).toBeVisible())
    fireEvent.click(row); expect(pick).toHaveBeenCalledWith(groups[0])
    fireEvent.blur(row); expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('donut legend offers the same keyboard preview as its segment', async () => {
    render(<DonutChart groups={groups} onPick={() => {}}/>)
    fireEvent.focus(screen.getByRole('button', { name: /Gujarat/ }))
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('Gujarat')).toBeVisible())
    expect(document.querySelector('.insight-donut-segment[data-chart-active]')).toBeTruthy()
  })
  it('map states expose exact counts without changing the filter until activated', async () => {
    const select = vi.fn()
    render(<IndiaMap groups={groups} onSelect={select}/>)
    const state = screen.getByRole('button', { name: /^Filter Gujarat:/ })
    fireEvent.focus(state)
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('30')).toBeVisible())
    expect(select).not.toHaveBeenCalled()
    fireEvent.keyDown(state, { key: 'Enter' }); expect(select).toHaveBeenCalledWith(24)
  })
  it('zero trend values remain inspectable and do not open a false drill', async () => {
    const pick = vi.fn()
    const trend = [{ key: '2026-10-01', label: 'Oct 26', value: 70, count: 30, wonValue: 0, wonCount: 0, lostValue: 0, lostCount: 0 }] as InsightTrend[]
    render(<TrendChart data={trend} count onPick={pick}/>)
    const point = screen.getByRole('img', { name: /Closed \(Won\): 0/ })
    fireEvent.focus(point); await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('0')).toBeVisible())
    expect(document.querySelector('.insight-tracking-line')).toBeTruthy()
    fireEvent.click(point); expect(pick).not.toHaveBeenCalled()
  })
  it('KPI focus and arrow keys inspect periods while Enter retains its drill action', async () => {
    const click = vi.fn()
    render(<button onClick={click}>Pipeline<Sparkline values={[10, 20]} label="Pipeline" periods={['Sep', 'Oct']}/></button>)
    const kpi = screen.getByRole('button')
    fireEvent.focus(kpi)
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('Oct')).toBeVisible())
    fireEvent.keyDown(kpi, { key: 'ArrowLeft' })
    expect(within(screen.getByRole('tooltip')).getByText('Sep')).toBeVisible()
    fireEvent.click(kpi); expect(click).toHaveBeenCalledTimes(1)
  })
  it('clears stale context on data replacement, scroll, and unmount', () => {
    const { rerender, unmount } = render(<Bars groups={groups} onPick={() => {}}/>)
    fireEvent.focus(screen.getByRole('button', { name: /Gujarat/ }))
    fireEvent.scroll(window); expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(screen.getByRole('button', { name: /Gujarat/ }))
    rerender(<Bars groups={[groups[1]]} onPick={() => {}}/>)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(screen.getByRole('button', { name: /Maharashtra/ })); unmount()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('keeps a single contextual tooltip across charts and supports global Escape', () => {
    render(<><Bars groups={groups} onPick={() => {}}/><DonutChart groups={groups} onPick={() => {}}/></>)
    const rows = screen.getAllByRole('button', { name: /Gujarat/ })
    fireEvent.focus(rows[0]); expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    fireEvent.pointerEnter(rows[1], { pointerType: 'mouse' })
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('retained analytics bars and donut expose keyboard and touch previews', async () => {
    render(<><Bar label="Engaged" value={8} max={10} barClass="bg-teal"/><Donut connected={8} notConnected={2}/></>)
    fireEvent.focus(screen.getByRole('img', { name: 'Engaged: 8' }))
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('8')).toBeVisible())
    fireEvent.pointerDown(screen.getByRole('img', { name: 'Not connected: 2' }), { pointerType: 'touch' })
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('2')).toBeVisible())
  })
})

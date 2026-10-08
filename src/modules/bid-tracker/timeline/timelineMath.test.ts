import { describe, expect, it } from 'vitest'
import { addDays, formatTimelineDate, fromDay, toDay } from './timelineDates'
import {
  activeMilestone, cardDensity, clampView, clusterEvents, computeVariance, describeDurationVariance, describeEndVariance,
  describeStartVariance, domainSpan, lifecycleDomain, panStepDays, panView, positionRatio, shortName, todayFocusDay,
  todayPlacement, varianceSummary, zoomLevelOf, zoomView, axisTicks, stageOutlook } from './timelineMath'
import type { Milestone, TimelineEvent } from './types'

const ms = (over: Partial<Milestone>): Milestone => ({
  id: 'm', name: 'Phase', plannedStart: '2026-01-01', plannedEnd: '2026-01-11', status: 'UPCOMING', sequence: 1, ...over,
})
const ev = (id: string, date: string, over: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id, date, type: 'Issue', severity: 'Medium', title: id, status: 'Open', ...over,
})

describe('dates', () => {
  it('works in whole UTC days and formats en-IN style', () => {
    expect(toDay('2026-03-29') - toDay('2026-03-28')).toBe(1) // across a DST change elsewhere
    expect(fromDay(toDay('2026-01-16'))).toBe('2026-01-16')
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01')
    expect(formatTimelineDate('2026-01-16')).toBe('16 Jan 2026')
    expect(formatTimelineDate('2026-09-05')).toBe('05 Sep 2026')
  })
})

describe('positions', () => {
  it('is strictly time-proportional, 0 at start and 1 at end', () => {
    const s = toDay('2026-01-01')
    const e = toDay('2026-04-11') // 100 days
    expect(positionRatio(s, s, e)).toBe(0)
    expect(positionRatio(e, s, e)).toBe(1)
    expect(positionRatio(toDay('2026-01-26'), s, e)).toBeCloseTo(0.25)
    expect(positionRatio(s, s, s)).toBe(0)
  })

  it('places today before, inside or after the range', () => {
    const s = toDay('2026-01-01')
    const e = toDay('2026-02-01')
    expect(todayPlacement(s - 3, s, e)).toBe('before')
    expect(todayPlacement(s + 3, s, e)).toBe('inside')
    expect(todayPlacement(e + 1, s, e)).toBe('after')
    expect(todayFocusDay('2026-01-01', '2026-02-01', '2026-05-01', false)).toBe(e)
    expect(todayFocusDay('2026-01-01', '2026-02-01', '2026-01-10', true)).toBe(e)
    expect(todayFocusDay('2026-01-01', '2026-02-01', '2026-01-10', false)).toBe(toDay('2026-01-10'))
  })
})

describe('zoom and pan', () => {
  const domain = lifecycleDomain('2026-01-01', '2026-07-01')

  it('pads the domain so edge nodes are visible', () => {
    expect(domain.startDay).toBeLessThan(toDay('2026-01-01'))
    expect(domain.endDay).toBeGreaterThan(toDay('2026-07-01'))
  })

  it('applies presets as visible spans and recognises them', () => {
    const all = zoomView({ startDay: 0, spanDays: 1 }, 'All', domain)
    expect(all).toEqual({ startDay: domain.startDay, spanDays: domainSpan(domain) })
    const week = zoomView(all, '1W', domain, toDay('2026-03-01'))
    expect(week.spanDays).toBe(7)
    expect(week.startDay).toBeCloseTo(toDay('2026-03-01') - 3.5)
    expect(zoomLevelOf(30, domain)).toBe('1M')
    expect(zoomLevelOf(90, domain)).toBe('3M')
    expect(zoomLevelOf(41, domain)).toBe('custom')
  })

  it('clamps panning to the domain', () => {
    const month = zoomView({ startDay: domain.startDay, spanDays: 1 }, '1M', domain, toDay('2026-03-01'))
    expect(panView(month, -10_000, domain).startDay).toBe(domain.startDay)
    expect(panView(month, 10_000, domain).startDay).toBe(domain.endDay - 30)
    expect(clampView({ startDay: 0, spanDays: 1 }, domain).spanDays).toBe(3)
  })

  it('centres a window wider than a short domain', () => {
    const short = lifecycleDomain('2026-01-01', '2026-01-21')
    const v = zoomView({ startDay: short.startDay, spanDays: 5 }, '3M', short)
    expect(v.spanDays).toBe(90)
    expect(v.startDay + 45).toBeCloseTo((short.startDay + short.endDay) / 2)
  })

  it('steps 7 / 30 / 90 days, or 25% of the view on All', () => {
    const v = { startDay: 0, spanDays: 200 }
    expect(panStepDays('1W', v)).toBe(7)
    expect(panStepDays('1M', v)).toBe(30)
    expect(panStepDays('3M', v)).toBe(90)
    expect(panStepDays('All', v)).toBe(50)
  })
})

describe('variance', () => {
  it('describes early, late and on-time starts and ends', () => {
    expect(describeStartVariance(2)).toBe('Started 2 days late')
    expect(describeStartVariance(-1)).toBe('Started 1 day early')
    expect(describeStartVariance(0)).toBe('Started on time')
    expect(describeEndVariance(4)).toBe('Completed 4 days late')
    expect(describeEndVariance(-3)).toBe('Completed 3 days early')
    expect(describeEndVariance(0)).toBe('Completed on time')
    expect(describeDurationVariance(2)).toBe('Took 2 days longer than planned')
    expect(describeDurationVariance(-2)).toBe('Took 2 days less than planned')
  })

  it('computes start, end and duration variance for a finished phase', () => {
    const m = ms({ actualStart: '2026-01-03', actualEnd: '2026-01-15', status: 'COMPLETED' })
    expect(computeVariance(m, '2026-02-01')).toMatchObject({ plannedDuration: 10, actualDuration: 12, startDays: 2, endDays: 4, durationDays: 2 })
    expect(varianceSummary(m, '2026-02-01')).toEqual(['Started 2 days late', 'Completed 4 days late', 'Took 2 days longer than planned'])
  })

  it('reports a running overrun and tolerates missing actual dates', () => {
    const running = ms({ actualStart: '2026-01-01', status: 'DELAYED' })
    expect(computeVariance(running, '2026-01-14').overrunDays).toBe(3)
    expect(varianceSummary(running, '2026-01-14')).toContain('Running 3 days past plan')
    const none = ms({})
    expect(computeVariance(none, '2026-01-14')).toEqual({ plannedDuration: 10, actualDuration: undefined, startDays: undefined, endDays: undefined, durationDays: undefined, overrunDays: undefined })
    expect(varianceSummary(none, '2026-01-14')).toEqual([])
  })
})

describe('clustering', () => {
  it('groups events that would overlap at the current scale', () => {
    const events = [ev('a', '2026-01-01'), ev('b', '2026-01-02', { severity: 'Critical' }), ev('c', '2026-01-03'), ev('d', '2026-02-01')]
    const zoomedOut = clusterEvents(events, 4, 26) // 4 px/day: 3 days = 12px apart
    expect(zoomedOut.map((c) => c.events.length)).toEqual([3, 1])
    expect(zoomedOut[0].severity).toBe('Critical')
    expect(zoomedOut[0].day).toBeCloseTo(toDay('2026-01-02'))
    const zoomedIn = clusterEvents(events, 40, 26)
    expect(zoomedIn).toHaveLength(4)
  })

  it('scales to 200+ events and skips undated ones', () => {
    const many = Array.from({ length: 240 }, (_, i) => ev(`e${i}`, addDays('2025-01-01', i * 3)))
    expect(clusterEvents([...many, ev('bad', 'n/a')], 0.5, 26).reduce((s, c) => s + c.events.length, 0)).toBe(240)
  })
})

describe('cards', () => {
  it('collapses by available width and shortens long names', () => {
    expect(cardDensity(40)).toBe('compact')
    expect(cardDensity(120)).toBe('medium')
    expect(cardDensity(300)).toBe('full')
    expect(shortName('Commercial Proposal')).toBe('Commercial')
    expect(shortName('Submitted')).toBe('Submitted')
  })

  it('finds the active phase', () => {
    expect(activeMilestone([ms({ id: 'a', status: 'COMPLETED' }), ms({ id: 'b', status: 'DELAYED' })])?.id).toBe('b')
    expect(activeMilestone([ms({ id: 'a', status: 'UPCOMING' })])).toBeUndefined()
  })
})

describe('axisTicks', () => {
  const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000
  it('uses daily ticks when zoomed in and keeps them at least the minimum gap apart', () => {
    const ticks = axisTicks(day(2026, 1, 1), day(2026, 1, 7), 140)
    expect(ticks.map((t) => t.label)).toEqual(['01 Jan', '02 Jan', '03 Jan', '04 Jan', '05 Jan', '06 Jan', '07 Jan'])
  })
  it('aligns weekly ticks to Mondays', () => {
    const ticks = axisTicks(day(2026, 1, 1), day(2026, 1, 31), 12)
    expect(ticks.every((t) => new Date(t.day * 86_400_000).getUTCDay() === 1)).toBe(true)
    expect(ticks[0].label).toBe('05 Jan')
  })
  it('switches to calendar months for long ranges, marking the new year', () => {
    const ticks = axisTicks(day(2025, 10, 15), day(2026, 3, 31), 3)
    expect(ticks.map((t) => t.label)).toEqual(['Nov', 'Dec', '2026', 'Feb', 'Mar'])
    expect(ticks.find((t) => t.label === '2026')?.major).toBe(true)
  })
  it('steps by quarters for multi-year ranges', () => {
    const ticks = axisTicks(day(2026, 1, 1), day(2028, 12, 31), 0.6)
    const gaps = ticks.slice(1).map((t, i) => t.day - ticks[i].day)
    expect(Math.min(...gaps) * 0.6).toBeGreaterThanOrEqual(72 - 1)
  })
})

describe('stageOutlook', () => {
  const base = { id: 'm', name: 'M', sequence: 1, plannedStart: '2026-01-01', plannedEnd: '2026-01-11' } as const
  it('uses the actual end once a stage is finished', () => {
    expect(stageOutlook({ ...base, status: 'COMPLETED', actualStart: '2026-01-02', actualEnd: '2026-01-15' }, '2026-02-01'))
      .toMatchObject({ end: '2026-01-15', endIsActual: true, endDelta: 4, plannedDays: 10, actualDays: 13, ongoing: false })
  })
  it('forecasts planned duration from the actual start, never before today', () => {
    expect(stageOutlook({ ...base, status: 'IN_PROGRESS', actualStart: '2026-01-03' }, '2026-01-05')).toMatchObject({ end: '2026-01-13', endDelta: 2, ongoing: true })
    expect(stageOutlook({ ...base, status: 'DELAYED', actualStart: '2026-01-03' }, '2026-01-20')).toMatchObject({ end: '2026-01-20', endDelta: 9, actualDays: 17 })
  })
  it('falls back to the plan before a stage starts', () => {
    const upcoming = stageOutlook({ ...base, status: 'UPCOMING' }, '2026-01-05')
    expect(upcoming).toMatchObject({ end: '2026-01-11', endDelta: 0, ongoing: false })
    expect(upcoming.actualDays).toBeUndefined()
  })
})

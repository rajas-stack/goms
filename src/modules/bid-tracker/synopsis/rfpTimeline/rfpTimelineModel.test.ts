import { describe, expect, it } from 'vitest'
import { buildRfpTimeline, extractDate, gapLabel, layoutChart, relativeLabel, statusOf } from './rfpTimelineModel'

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

describe('extractDate', () => {
  it('reads dotted Indian dates with a written time', () => {
    expect(extractDate('05.11.2026 at 11:00 AM, Conference Hall, New Delhi')).toEqual({ date: local(2026, 11, 5, 11, 0), hasTime: true })
  })

  it('reads named-month dates and "12 Noon"', () => {
    expect(extractDate('On 13th May, 2026 at 12 Noon')).toEqual({ date: local(2026, 5, 13, 12, 0), hasTime: true })
  })

  it('falls back to the date alone when there is no time', () => {
    expect(extractDate('Pre-bid on 2026-06-01 via video call')).toEqual({ date: local(2026, 6, 1), hasTime: false })
  })

  it('returns null for text without a date', () => {
    expect(extractDate('3 years from award')).toBeNull()
  })
})

describe('buildRfpTimeline', () => {
  it('sorts every dated General field chronologically and lists unreadable ones', () => {
    const timeline = buildRfpTimeline({
      bidDeadline: '2026-11-05T12:00',
      publishingDate: '2026-10-01',
      preBidMeeting: '15/10/2026 3pm, Committee Room',
      queriesDeadline: 'to be announced',
      tenderId: '2026_X_1',
    })
    expect(timeline.dates.map(d => d.key)).toEqual(['publishingDate', 'preBidMeeting', 'bidDeadline'])
    expect(timeline.dates[1]).toMatchObject({ date: local(2026, 10, 15, 15, 0), hasTime: true, label: 'Pre-Bid Meeting Date & Time' })
    expect(timeline.unreadable).toEqual([{ key: 'queriesDeadline', label: 'Last Date & Time of Submission of Queries', raw: 'to be announced' }])
  })

  it('is empty when nothing is filled in', () => {
    expect(buildRfpTimeline({})).toEqual({ dates: [], unreadable: [] })
  })
})

describe('gaps and status', () => {
  const [a, b, c] = buildRfpTimeline({ publishingDate: '2026-10-01', queriesDeadline: '2026-10-13T10:00', bidDeadline: '2026-10-13T13:30' }).dates

  it('labels gaps in days, or hours on the same day', () => {
    expect(gapLabel(a, b)).toBe('+12 days')
    expect(gapLabel(b, c)).toBe('+3 h 30 min')
  })

  it('classifies past, today and upcoming relative to now', () => {
    const now = local(2026, 10, 13, 12, 0)
    expect(statusOf(a, now)).toBe('past')
    expect(statusOf(b, now)).toBe('past')
    expect(statusOf(c, now)).toBe('today')
    expect(relativeLabel(a, now)).toBe('12 days ago')
  })

  it('lays markers out in proportion to time and places today within range', () => {
    const layout = layoutChart([a, b, c], local(2026, 10, 7))
    expect(layout.markers).toHaveLength(2) // b and c share a day
    expect(layout.markers[0].position).toBeCloseTo(0.04)
    expect(layout.markers[1].position).toBeCloseTo(0.96)
    expect(layout.phases[0]).toMatchObject({ days: 12, status: 'current' })
    expect(layout.phases[0].progress).toBeCloseTo(0.5)
    expect(layout.todayPosition).toBeCloseTo(0.5)
    expect(layoutChart([a], local(2030, 1, 1)).todayPosition).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { bookedHours, byDay, countdown, dayKey, monthGrid, parseEvent } from './model'

describe('calendar model', () => {
  it('builds a six-week Monday-first grid that starts on or before the 1st', () => {
    const grid = monthGrid(2026, 9) // October 2026 starts on a Thursday
    expect(grid).toHaveLength(42)
    expect(dayKey(grid[0])).toBe('2026-09-28')
    expect(grid[0].getDay()).toBe(1)
  })

  it('reads all-day dates as local days and spreads multi-day events across each day', () => {
    const e = parseEvent({ id: 'a', summary: 'Offsite', start: { date: '2026-10-29' }, end: { date: '2026-10-31' } })!
    expect(e.allDay).toBe(true)
    expect([...byDay([e]).keys()]).toEqual(['2026-10-29', '2026-10-30'])
  })

  it('drops cancelled events and picks up the Meet link', () => {
    expect(parseEvent({ id: 'x', status: 'cancelled', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } })).toBeNull()
    const e = parseEvent({ id: 'b', start: { dateTime: '2026-10-29T10:00:00+05:30' }, end: { dateTime: '2026-10-29T11:00:00+05:30' }, hangoutLink: 'https://meet.google.com/abc' })!
    expect(e.meetUrl).toBe('https://meet.google.com/abc')
    expect(e.title).toBe('(No title)')
  })

  it('counts down to, through and past an event', () => {
    const e = parseEvent({ id: 'c', start: { dateTime: '2026-10-29T10:00:00Z' }, end: { dateTime: '2026-10-29T11:00:00Z' } })!
    expect(countdown(Date.parse('2026-10-29T08:55:00Z'), e)).toBe('in 1 h 5 min')
    expect(countdown(Date.parse('2026-10-29T10:48:00Z'), e)).toBe('Now · 12 min left')
    expect(countdown(Date.parse('2026-10-29T12:00:00Z'), e)).toBe('Ended')
  })

  it('counts overlapping meetings once when totalling booked hours', () => {
    const day = new Date(2026, 9, 29)
    const at = (h: number) => new Date(2026, 9, 29, h).toISOString()
    const a = parseEvent({ id: 'a', start: { dateTime: at(9) }, end: { dateTime: at(11) } })!
    const b = parseEvent({ id: 'b', start: { dateTime: at(10) }, end: { dateTime: at(12) } })!
    expect(bookedHours([a, b], day)).toBe(3)
  })
})

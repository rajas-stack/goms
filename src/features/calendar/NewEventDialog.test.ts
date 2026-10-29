import { describe, expect, it } from 'vitest'
import { parseNewEvent } from './NewEventDialog'

const draft = { title: 'Client review', date: '2026-10-30', start: '10:00', end: '11:00', allDay: false, location: '', description: '', meet: true }

describe('parseNewEvent', () => {
  it('builds a timed event with a Meet link', () => {
    const e = parseNewEvent(draft)
    expect(e).toMatchObject({ title: 'Client review', allDay: false, meet: true })
    expect(typeof e !== 'string' && e.end.getTime() - e.start.getTime()).toBe(3_600_000)
  })
  it('rejects a missing title and an end before the start', () => {
    expect(parseNewEvent({ ...draft, title: '  ' })).toMatch(/title/)
    expect(parseNewEvent({ ...draft, end: '09:00' })).toMatch(/end after/)
  })
  it('makes an all-day event span exactly one day, without Meet', () => {
    const e = parseNewEvent({ ...draft, allDay: true })
    expect(e).toMatchObject({ allDay: true, meet: false })
    expect(typeof e !== 'string' && e.end.getDate() - e.start.getDate()).toBe(1)
  })
})

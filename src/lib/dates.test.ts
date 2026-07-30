import { describe, expect, it } from 'vitest'
import { toLocalIsoDate } from './dates'

describe('toLocalIsoDate', () => {
  it('uses local calendar fields, not UTC', () => {
    // 2026-03-15 02:30 local. In any timezone east of UTC this instant is
    // still 2026-03-14 in UTC, which is exactly the bug being fixed.
    const d = new Date(2026, 2, 15, 2, 30, 0)
    expect(toLocalIsoDate(d)).toBe('2026-03-15')
  })

  it('zero-pads month and day', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('handles the last day of a year', () => {
    expect(toLocalIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })
})

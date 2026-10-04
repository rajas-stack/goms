import { describe, expect, it } from 'vitest'
import { formatCapturedDate, parseFriendlyDate } from './dateInput'

describe('bid deadline input parsing', () => {
  it.each([
    ['13th may 2026 1500', new Date(2026, 4, 13, 15), '13 May 2026, 15:00'],
    ['13/5/26 3pm', new Date(2026, 4, 13, 15), '13 May 2026, 15:00'],
    ['24thsept261500', new Date(2026, 8, 24, 15), '24 September 2026, 15:00'],
  ])('parses %s with its date and time', (input, expected, preview) => {
    expect(parseFriendlyDate(input)).toEqual(expected)
    expect(formatCapturedDate(input)).toBe(preview)
  })

  it('rejects impossible calendar dates instead of rolling them forward', () => {
    expect(parseFriendlyDate('Feb 30 2026')).toBeNull()
    expect(parseFriendlyDate('2026-02-30T15:00:00')).toBeNull()
    expect(parseFriendlyDate('2026/02/30')).toBeNull()
    expect(formatCapturedDate('Feb 30 2026')).toBe('')
  })
})
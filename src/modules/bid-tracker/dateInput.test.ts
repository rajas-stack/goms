import { describe, expect, it } from 'vitest'
import { formatCapturedDate, formatCellDate, parseCellDate, parseFriendlyDate } from './dateInput'

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

describe('date cells', () => {
  it.each([
    // dd-mm-yyyy with seconds, as a spreadsheet exports it (the reported "Could not read that date").
    ['09-10-2026 00:00:00', true, '2026-10-09T00:00'],
    ['09-10-2026 14:30', true, '2026-10-09T14:30'],
    ['9 Oct 2026 3pm', true, '2026-10-09T15:00'],
    ['13th may 2026 1500', true, '2026-05-13T15:00'],
    // The time is optional: a date typed alone stays date-only, and a date-only field never keeps one.
    ['09-10-2026', true, '2026-10-09'],
    ['09 Oct 2026', true, '2026-10-09'],
    ['09-10-2026 14:30', false, '2026-10-09'],
    ['09 Oct 2026 00:00', true, '2026-10-09T00:00'],
    ['31-02-2026', true, ''],
    ['soon', true, ''],
  ])('reads %s (time allowed: %s) as %s', (text, withTime, stored) => {
    expect(parseCellDate(text, withTime)).toBe(stored)
  })

  it('shows stored values formatted, never as raw ISO', () => {
    expect(formatCellDate('2026-10-09T00:00')).toBe('09 Oct 2026, 00:00')
    expect(formatCellDate('2026-10-09T14:30:00')).toBe('09 Oct 2026, 14:30')
    expect(formatCellDate('2026-10-09')).toBe('09 Oct 2026')
    expect(formatCellDate('as per corrigendum')).toBe('as per corrigendum')
    expect(formatCellDate('2026-02-30')).toBe('2026-02-30')
  })
})
import { describe, expect, it } from 'vitest'
import {
  formatFriendlyPreview, formatFriendlyValue, friendlyValueToDate, parseFriendlyDate, parseFriendlyValue,
} from './friendlyDate'

describe('parseFriendlyValue', () => {
  it.each([
    ['13th May 2026', '2026-05-13'],
    ['13/5/26', '2026-05-13'],
    ['May 13, 2026', '2026-05-13'],
    ['2026-05-13', '2026-05-13'],
    ['2026/05/13', '2026-05-13'],
    ['13/5/26 3pm', '2026-05-13'],
  ])('reads %s as the date %s', (text, expected) => {
    expect(parseFriendlyValue(text, 'date')).toBe(expected)
  })

  it.each([
    ['21.09.2026', '2026-09-21'],
    ['21.9.26', '2026-09-21'],
    ['21.09.26', '2026-09-21'],
    ['21092026', '2026-09-21'],
    ['210926', '2026-09-21'],
  ])('reads day-first dotted / compact %s as %s', (text, expected) => {
    expect(parseFriendlyValue(text, 'date')).toBe(expected)
  })

  it('keeps a time typed after a dotted or compact date', () => {
    expect(parseFriendlyValue('21.09.2026 3pm', 'datetime-local')).toBe('2026-09-21T15:00')
    expect(parseFriendlyValue('21092026 15:30', 'datetime-local')).toBe('2026-09-21T15:30')
  })

  it.each(['31022026', '310226', '31.02.2026', '30.13.2026', '1.5', '2109202'])('rejects impossible or ambiguous %s', (text) => {
    expect(parseFriendlyValue(text, 'date')).toBe('')
  })

  it('keeps the time for a datetime-local field', () => {
    expect(parseFriendlyValue('13th May 2026 3pm', 'datetime-local')).toBe('2026-05-13T15:00')
    expect(parseFriendlyValue('2026-05-13T09:30', 'datetime-local')).toBe('2026-05-13T09:30')
  })

  it('returns a full ISO instant for an iso field', () => {
    expect(parseFriendlyValue('13/5/26 15:00', 'iso')).toBe(new Date(2026, 4, 13, 15).toISOString())
  })

  it('returns empty for blank or unreadable text', () => {
    expect(parseFriendlyValue('', 'date')).toBe('')
    expect(parseFriendlyValue('next tuesday-ish', 'date')).toBe('')
    expect(parseFriendlyValue('31/2/26', 'date')).toBe('')
  })
})

describe('formatFriendlyValue', () => {
  it('shows a stored value as text the parser reads back to the same value', () => {
    for (const [value, format] of [['2026-05-13', 'date'], ['2026-09-24T15:05', 'datetime-local']] as const) {
      const text = formatFriendlyValue(value, format)
      expect(parseFriendlyValue(text, format)).toBe(value)
    }
    expect(formatFriendlyValue('2026-05-13', 'date')).toBe('13 May 2026')
    expect(formatFriendlyValue('2026-05-13T15:00', 'datetime-local')).toBe('13 May 2026 15:00')
  })

  it('round-trips an ISO instant through local time', () => {
    const iso = new Date(2026, 4, 13, 15).toISOString()
    expect(parseFriendlyValue(formatFriendlyValue(iso, 'iso'), 'iso')).toBe(iso)
  })

  it('leaves empty and unrecognised values as they are', () => {
    expect(formatFriendlyValue('', 'date')).toBe('')
    expect(formatFriendlyValue('sometime', 'date')).toBe('sometime')
    expect(friendlyValueToDate('2026-02-30', 'date')).toBeNull()
  })
})

describe('formatFriendlyPreview', () => {
  it('never shows a time for a date-only field', () => {
    expect(formatFriendlyPreview('13/5/26 3pm', 'date')).toBe('13 May 2026')
    expect(formatFriendlyPreview('13/5/26 3pm', 'datetime-local')).toBe('13 May 2026, 15:00')
    expect(formatFriendlyPreview('nope', 'date')).toBe('')
  })

  it('still parses the formats the bid deadline field accepted', () => {
    expect(parseFriendlyDate('24thsept261500')).toEqual(new Date(2026, 8, 24, 15))
  })
})

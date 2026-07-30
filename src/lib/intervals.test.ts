import { describe, expect, it } from 'vitest'
import {
  activeAt, closeAt, coversDate, displayEndDate, openRow, sortByStart, validateContiguity,
  type Interval,
} from './intervals'

const iv = (startDate: string, endDate: string | null = null): Interval => ({ startDate, endDate })

describe('coversDate — half-open boundaries', () => {
  it('includes the exact start date', () => {
    expect(coversDate(iv('2025-01-01', '2025-07-01'), '2025-01-01')).toBe(true)
  })

  it('EXCLUDES the exact end date', () => {
    expect(coversDate(iv('2025-01-01', '2025-07-01'), '2025-07-01')).toBe(false)
  })

  it('includes the day before the end date', () => {
    expect(coversDate(iv('2025-01-01', '2025-07-01'), '2025-06-30')).toBe(true)
  })

  it('excludes the day before the start date', () => {
    expect(coversDate(iv('2025-01-01', '2025-07-01'), '2024-12-31')).toBe(false)
  })

  it('treats a null end as open-ended', () => {
    expect(coversDate(iv('2025-01-01', null), '2099-01-01')).toBe(true)
  })

  it('still respects the start date when the end is null', () => {
    expect(coversDate(iv('2025-01-01', null), '2024-12-31')).toBe(false)
  })
})

describe('activeAt / openRow', () => {
  const rows = [iv('2025-01-01', '2025-07-01'), iv('2025-07-01', null)]

  it('picks the earlier row on its own last covered day', () => {
    expect(activeAt(rows, '2025-06-30')).toEqual([rows[0]])
  })

  it('picks the later row on the handover date', () => {
    expect(activeAt(rows, '2025-07-01')).toEqual([rows[1]])
  })

  it('returns nothing before any row starts', () => {
    expect(activeAt(rows, '2024-01-01')).toEqual([])
  })

  it('finds the single open row', () => {
    expect(openRow(rows)).toEqual(rows[1])
  })

  it('returns undefined when every row is closed', () => {
    expect(openRow([iv('2025-01-01', '2025-07-01')])).toBeUndefined()
  })
})

describe('closeAt', () => {
  it('sets the exclusive end date without mutating the input', () => {
    const row = iv('2025-01-01', null)
    const closed = closeAt(row, '2025-07-01')
    expect(closed.endDate).toBe('2025-07-01')
    expect(row.endDate).toBeNull()
  })

  it('rejects an end date before the start date', () => {
    expect(() => closeAt(iv('2025-07-01', null), '2025-01-01')).toThrow(/before its start/)
  })

  it('rejects an end date equal to the start date', () => {
    expect(() => closeAt(iv('2025-07-01', null), '2025-07-01')).toThrow(/before its start/)
  })
})

describe('validateContiguity', () => {
  it('accepts adjacent half-open rows', () => {
    expect(validateContiguity([iv('2025-01-01', '2025-07-01'), iv('2025-07-01', null)])).toEqual([])
  })

  it('accepts an empty list', () => {
    expect(validateContiguity([])).toEqual([])
  })

  it('reports a gap', () => {
    const problems = validateContiguity([iv('2025-01-01', '2025-06-01'), iv('2025-07-01', null)])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/gap/i)
  })

  it('reports an overlap', () => {
    const problems = validateContiguity([iv('2025-01-01', '2025-08-01'), iv('2025-07-01', null)])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/overlap/i)
  })

  it('reports more than one open row', () => {
    const problems = validateContiguity([iv('2025-01-01', null), iv('2025-07-01', null)])
    expect(problems.some((p) => /more than one open/i.test(p))).toBe(true)
  })

  it('reports a row whose end precedes its start', () => {
    const problems = validateContiguity([iv('2025-07-01', '2025-01-01')])
    expect(problems.some((p) => /ends before/i.test(p))).toBe(true)
  })
})

describe('displayEndDate', () => {
  it('converts an exclusive end to the inclusive last owned day', () => {
    expect(displayEndDate('2025-07-01')).toBe('2025-06-30')
  })

  it('steps back across a month boundary', () => {
    expect(displayEndDate('2025-03-01')).toBe('2025-02-28')
  })

  it('steps back across a year boundary', () => {
    expect(displayEndDate('2026-01-01')).toBe('2025-12-31')
  })

  it('returns null for an open interval', () => {
    expect(displayEndDate(null)).toBeNull()
  })
})

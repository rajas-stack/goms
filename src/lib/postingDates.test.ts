import { describe, expect, it } from 'vitest'
import { addDays, isValidIsoDate, PostingDatesError, planPostingDatesEdit, type PostingInterval } from '@goms/domain'
import { validateContiguity } from './intervals'

// A promotion history: p1 (closed) → p2 (current, open).
const p1: PostingInterval = { id: 'p1', startDate: '2024-01-01', endDate: '2025-07-01' }
const p2: PostingInterval = { id: 'p2', startDate: '2025-07-01', endDate: null }
const solo: PostingInterval = { id: 's', startDate: '1970-01-01', endDate: null }

describe('addDays / isValidIsoDate', () => {
  it('handles month, year and leap-year boundaries', () => {
    expect(addDays('2025-06-30', 1)).toBe('2025-07-01')
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
  })
  it('rejects impossible and malformed dates', () => {
    expect(isValidIsoDate('2025-02-30')).toBe(false)
    expect(isValidIsoDate('2025-13-01')).toBe(false)
    expect(isValidIsoDate('01/02/2025')).toBe(false)
    expect(isValidIsoDate('2024-02-29')).toBe(true)
  })
})

describe('planPostingDatesEdit', () => {
  it('sets Effective from on a lone current posting (the imported 1970-01-01 case)', () => {
    expect(planPostingDatesEdit([solo], 's', { startDate: '2021-04-01' })).toEqual({ startDate: '2021-04-01', endDate: null })
  })

  it('converts last-day-held to the stored exclusive end', () => {
    expect(planPostingDatesEdit([solo], 's', { lastDayHeld: '2026-03-31' })).toEqual({ startDate: '1970-01-01', endDate: '2026-04-01' })
  })

  it('clearing Effective to reopens the latest posting (Present)', () => {
    const closed = { ...solo, endDate: '2026-04-01' }
    expect(planPostingDatesEdit([closed], 's', { lastDayHeld: null })).toEqual({ startDate: '1970-01-01', endDate: null })
  })

  it('moving the current posting start moves the previous posting end so history stays contiguous', () => {
    const plan = planPostingDatesEdit([p1, p2], 'p2', { startDate: '2025-09-15' })
    expect(plan).toEqual({ startDate: '2025-09-15', endDate: null, previous: { id: 'p1', endDate: '2025-09-15' } })
    const after = [{ ...p1, endDate: plan.previous!.endDate }, { ...p2, startDate: plan.startDate }]
    expect(validateContiguity(after)).toEqual([])
  })

  it('moving the start earlier also keeps contiguity', () => {
    const plan = planPostingDatesEdit([p1, p2], 'p2', { startDate: '2025-03-01' })
    expect(plan.previous).toEqual({ id: 'p1', endDate: '2025-03-01' })
  })

  it('does not touch the previous posting when start is unchanged', () => {
    expect(planPostingDatesEdit([p1, p2], 'p2', { lastDayHeld: '2026-01-31' }).previous).toBeUndefined()
  })

  it('rejects a start on or before the previous posting start', () => {
    expect(() => planPostingDatesEdit([p1, p2], 'p2', { startDate: '2024-01-01' })).toThrow(/after the previous posting's start/)
    expect(() => planPostingDatesEdit([p1, p2], 'p2', { startDate: '2023-06-01' })).toThrow(PostingDatesError)
  })

  it('rejects Effective to before Effective from (last day held must be on/after start)', () => {
    expect(() => planPostingDatesEdit([p1, p2], 'p2', { lastDayHeld: '2025-06-30' })).toThrow(/on or after Effective from/)
    // last day == start day is a valid one-day posting (stored end = start + 1)
    expect(planPostingDatesEdit([p1, p2], 'p2', { lastDayHeld: '2025-07-01' }).endDate).toBe('2025-07-02')
  })

  it('rejects an open-ended posting when a later one exists', () => {
    expect(() => planPostingDatesEdit([p1, p2], 'p1', { lastDayHeld: null })).toThrow(/later posting starts on 2025-07-01/)
  })

  it('rejects reopening when another posting is already current', () => {
    const closedLater = { id: 'p3', startDate: '2020-01-01', endDate: '2021-01-01' }
    expect(() => planPostingDatesEdit([closedLater, { id: 'cur', startDate: '2021-01-01', endDate: null }], 'p3', { lastDayHeld: null }))
      .toThrow(PostingDatesError)
  })

  it('rejects changing the end of a posting that has a successor to anything but the successor start', () => {
    expect(() => planPostingDatesEdit([p1, p2], 'p1', { lastDayHeld: '2025-05-31' })).toThrow(/edit that posting's Effective from instead/)
    // the successor's own start is the legal boundary (last day = day before)
    expect(planPostingDatesEdit([p1, p2], 'p1', { lastDayHeld: '2025-06-30' }).endDate).toBe('2025-07-01')
  })

  it('rejects invalid dates and unknown postings', () => {
    expect(() => planPostingDatesEdit([solo], 's', { startDate: '2025-02-30' })).toThrow(/not a valid date/)
    expect(() => planPostingDatesEdit([solo], 's', { lastDayHeld: 'soon' })).toThrow(/not a valid date/)
    expect(() => planPostingDatesEdit([solo], 'nope', {})).toThrow(/no longer exists/)
  })

  it('an empty edit is a no-op plan', () => {
    expect(planPostingDatesEdit([p1, p2], 'p2', {})).toEqual({ startDate: '2025-07-01', endDate: null })
  })
})

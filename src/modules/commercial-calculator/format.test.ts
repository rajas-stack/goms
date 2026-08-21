import { describe, expect, it } from 'vitest'
import { formatPercent, isNegativeMargin, roundMoney } from './format'

describe('formatPercent', () => {
  it('strips floating-point noise and a meaningless trailing zero for a whole-number result', () => {
    expect(formatPercent(7.000000000000001)).toBe('7%')
    expect(formatPercent(12.000000000000002)).toBe('12%')
  })

  it('keeps genuine fractional precision', () => {
    expect(formatPercent(21.300000000000004)).toBe('21.3%')
  })

  it('formats a negative value with its sign intact', () => {
    expect(formatPercent(-58.4)).toBe('-58.4%')
    expect(formatPercent(-58.40000000000001)).toBe('-58.4%')
  })

  it('does not render a bare "-0%" for values that round to negative zero', () => {
    expect(formatPercent(-0.00000001)).toBe('0%')
  })

  it('respects a custom maxDecimals', () => {
    expect(formatPercent(12.345, 2)).toBe('12.35%')
    expect(formatPercent(12, 2)).toBe('12%')
  })
})

describe('isNegativeMargin', () => {
  it('is true only below zero', () => {
    expect(isNegativeMargin(-0.1)).toBe(true)
    expect(isNegativeMargin(0)).toBe(false)
    expect(isNegativeMargin(5)).toBe(false)
  })
})

describe('roundMoney', () => {
  it('strips floating-point noise from a back-solved price (85000 list, 30% discount)', () => {
    expect(roundMoney(85000 * (1 - 30 / 100))).toBe(59500)
  })

  it('keeps genuine cents precision', () => {
    expect(roundMoney(733.335)).toBe(733.34)
    expect(roundMoney(733.33)).toBe(733.33)
  })

  it('respects a custom maxDecimals', () => {
    expect(roundMoney(12.3456, 3)).toBe(12.346)
  })
})

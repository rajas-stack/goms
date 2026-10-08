import { describe, expect, it } from 'vitest'
import { canComputeMargin, formatRestricted, isRestricted } from './restricted'

describe('restricted values', () => {
  it('null means hidden, 0 is a real zero', () => {
    expect(isRestricted(null)).toBe(true)
    expect(isRestricted(0)).toBe(false)
    expect(formatRestricted(null, (n) => `₹${n}`)).toBe('Restricted')
    expect(formatRestricted(0, (n) => `₹${n}`)).toBe('₹0')
  })
  it('margin needs every involved SKU\'s cost to be visible', () => {
    expect(canComputeMargin([{ maskedFields: [] }, {}])).toBe(true)
    expect(canComputeMargin([{ maskedFields: [] }, { maskedFields: ['hardwareCost'] }])).toBe(false)
    expect(canComputeMargin([])).toBe(true)
  })
})

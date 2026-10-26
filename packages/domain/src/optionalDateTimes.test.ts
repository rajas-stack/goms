import { describe, expect, it } from 'vitest'
import { coerceCustomValue, matchesTypedRule } from './bidCustomFields'
import { validateLifecycleData } from './opportunityLifecycle'

describe('optional clock times on calendar dates', () => {
  it('retains date-only values, noon and explicitly entered midnight', () => {
    for (const date of ['2026-10-09', '2026-10-09T15:45', '2026-10-09T00:00']) {
      expect(coerceCustomValue('date', date)).toBe(date)
      expect(() => validateLifecycleData({ expectedRfpDate: date }, 'pipeline-funnel')).not.toThrow()
    }
    for (const date of ['2026-02-30T14:00', '2026-10-09T24:00', '2026-10-09T14:61']) expect(() => coerceCustomValue('date', date)).toThrow()
  })
  it('can filter an entire day or compare specific times', () => {
    expect(matchesTypedRule('date', '2026-10-09T15:45', { operator: 'eq' }, '2026-10-09')).toBe(true)
    expect(matchesTypedRule('date', '2026-10-09T15:45', { operator: 'after' }, '2026-10-09T14:00')).toBe(true)
    expect(matchesTypedRule('date', '2026-10-09T15:45', { operator: 'before' }, '2026-10-09T14:00')).toBe(false)
    expect(matchesTypedRule('date', '2026-10-09T23:59', { operator: 'between', value2: '2026-10-09' }, '2026-10-08')).toBe(true)
  })
})

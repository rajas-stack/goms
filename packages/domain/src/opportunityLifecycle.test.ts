import { describe, expect, it } from 'vitest'
import { assertLifecycleMove, furthestLifecycleSheet, lifecycleRowInSheet, lifecycleSections, validateLifecycleData } from './opportunityLifecycle'
import { applyFilterRules } from './bids'

describe('opportunity lifecycle', () => {
  it('filters the saved stage fields using their data types and current-stage visibility', () => {
    const rows = [
      { id: 'later', sheet: 'pipeline-funnel', lifecycleData: { leadSource: 'Client meeting', expectedRfpDate: '2027-01-15' } },
      { id: 'reversed', sheet: 'campaign', lifecycleData: { leadSource: 'Website', expectedRfpDate: '2027-01-15' } },
    ]
    expect(applyFilterRules(rows, [{ field: 'lifecycle:leadSource', operator: 'contains', value: 'meeting' }], null).map(row => row.id)).toEqual(['later'])
    expect(applyFilterRules(rows, [{ field: 'lifecycle:expectedRfpDate', operator: 'eq', value: '2027-01-15' }], null).map(row => row.id)).toEqual(['later'])
  })
  it('unlocks only the current and earlier ecosystems', () => {
    expect(lifecycleSections('campaign').map(stage => stage.sheet)).toEqual(['campaign'])
    expect(lifecycleSections('pipeline-backup').map(stage => stage.sheet)).toEqual(['campaign', 'pipeline-funnel', 'pipeline-backup'])
    expect(lifecycleSections('bidTracker')).toHaveLength(5)
  })

  it('allows adjacent forward and backward moves and rejects skipped stages', () => {
    expect(() => assertLifecycleMove('campaign', 'pipeline-funnel')).not.toThrow()
    expect(() => assertLifecycleMove('pipeline-funnel', 'campaign')).not.toThrow()
    expect(() => assertLifecycleMove('pipeline-commits', 'bidTracker')).not.toThrow()
    expect(() => assertLifecycleMove('campaign', 'bidTracker')).toThrow('one stage at a time')
    expect(() => assertLifecycleMove('bidTracker', 'campaign')).toThrow('one stage at a time')
  })

  it('keeps one row in every reached stage after advancing and reversing', () => {
    const reached = furthestLifecycleSheet('pipeline-commits', undefined, 'pipeline-backup')
    expect(reached).toBe('pipeline-commits')
    const row = { sheet: 'pipeline-backup' as const, lifecycleReachedSheet: reached }
    for (const sheet of ['campaign', 'pipeline-funnel', 'pipeline-backup', 'pipeline-commits', 'master'] as const) expect(lifecycleRowInSheet(row, sheet)).toBe(true)
    expect(lifecycleRowInSheet(row, 'bidTracker')).toBe(false)
  })

  it('preserves legacy live-bid membership without requiring a new field', () => {
    expect(lifecycleRowInSheet({}, 'campaign')).toBe(true)
    expect(lifecycleRowInSheet({ sheet: 'campaign' }, 'bidTracker')).toBe(false)
  })

  it('rejects future, unknown and oversized fields', () => {
    expect(() => validateLifecycleData({ clientNeed: 'Fleet visibility' }, 'campaign')).not.toThrow()
    expect(() => validateLifecycleData({ resourcePlan: 'Partner' }, 'campaign')).toThrow('Commit')
    expect(() => validateLifecycleData({ unknown: 'x' }, 'campaign')).toThrow('Unknown')
    expect(() => validateLifecycleData({ clientNeed: 'x'.repeat(10001) }, 'campaign')).toThrow('10,000')
  })

  it('validates actual calendar dates and permits clearing a date', () => {
    expect(() => validateLifecycleData({ expectedRfpDate: '2026-02-30' }, 'pipeline-funnel')).toThrow('valid date')
    expect(() => validateLifecycleData({ expectedRfpDate: '2026-02-28' }, 'pipeline-funnel')).not.toThrow()
    expect(() => validateLifecycleData({ expectedRfpDate: '' }, 'pipeline-funnel')).not.toThrow()
  })
})

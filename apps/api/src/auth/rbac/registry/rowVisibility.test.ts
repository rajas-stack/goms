import { describe, expect, it } from 'vitest'
import { PROCEDURE_POLICY } from './index.js'
import { filterRowsBySheet } from './rowVisibility.js'

const rows = [{ id: 1, sheet: 'bidTracker' }, { id: 2, sheet: 'pipeline-funnel' }, { id: 3, sheet: 'campaign' }, { id: 4 }]

describe('filterRowsBySheet — the Master Grid shows the union of the sheets a role can read', () => {
  it('keeps everything when every sheet module is readable', () => {
    expect(filterRowsBySheet(rows, () => true)).toEqual(rows)
  })
  it('drops rows whose sheet module is not readable', () => {
    expect(filterRowsBySheet(rows, (m) => m !== 'opp.pipeline').map((r: any) => r.id)).toEqual([1, 3, 4])
  })
  it('treats a row with no sheet as Bid Tracker', () => {
    expect(filterRowsBySheet(rows, (m) => m === 'opp.bidTracker').map((r: any) => r.id)).toEqual([1, 4])
  })
  it('passes non-arrays through untouched', () => {
    expect(filterRowsBySheet({ a: 1 }, () => false)).toEqual({ a: 1 })
  })
})

describe('registration', () => {
  it('the grid query is masked by sheet visibility', () => {
    expect(PROCEDURE_POLICY['bids.listForGrid'].mask).toBeTypeOf('function')
  })
})

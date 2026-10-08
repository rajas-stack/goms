import { describe, expect, it } from 'vitest'
import { SHEET_MODULE, sheetModule } from './sheets.js'

describe('sheet → module', () => {
  it('maps every owned sheet, defaulting an unknown or missing one to Bid Tracker', () => {
    expect(sheetModule('bidTracker')).toBe('opp.bidTracker')
    for (const s of ['pipeline-funnel', 'pipeline-backup', 'pipeline-commits']) expect(sheetModule(s)).toBe('opp.pipeline')
    expect(sheetModule('campaign')).toBe('opp.campaign')
    expect(sheetModule(undefined)).toBe('opp.bidTracker')
    expect(sheetModule('nonsense')).toBe('opp.bidTracker')
  })
  it('covers every owned sheet', () => {
    expect(Object.keys(SHEET_MODULE).sort()).toEqual(['bidTracker', 'campaign', 'pipeline-backup', 'pipeline-commits', 'pipeline-funnel'])
  })
})

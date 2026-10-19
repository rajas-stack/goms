import { describe, expect, it } from 'vitest'
import { BID_SYSTEM_FIELDS, BID_TRACKER_MASTER_KEYS, bidTrackerMasterSeed, resolveSystemOptions, withSystemOptions } from './bidTrackerFields.js'
import { validateBidTransfer, type BidTransferContext } from './bidTransfer.js'

const lookups = { masters: { emdInstruments: [{ name: 'BG', description: 'Bank Guarantee' }, { name: 'DD', description: 'Demand Draft' }], zones: [{ name: 'West' }] }, competitors: ['TCS'], preSales: ['Asha'] }

describe('built-in Bid Tracker fields', () => {
  it('every master-backed field points at a known master, and keys are unique', () => {
    const keys = BID_SYSTEM_FIELDS.map(f => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const f of BID_SYSTEM_FIELDS) if (f.source?.kind === 'master') expect(BID_TRACKER_MASTER_KEYS).toContain(f.source.masterKey)
  })
  it('seeds the listed values, EMD with full forms', () => {
    expect(bidTrackerMasterSeed('bidPriorities').map(r => r[1])).toEqual(['Hot', 'Cold'])
    expect(bidTrackerMasterSeed('emdInstruments')).toContainEqual(['BG', 'BG', 'Bank Guarantee'])
    expect(bidTrackerMasterSeed('tenderStatuses')).toHaveLength(34)
  })
  it('resolves options live from masters, competitors and the presales team', () => {
    expect(resolveSystemOptions('emd_mode', lookups)).toEqual({ options: ['BG', 'DD'], hints: { BG: 'Bank Guarantee', DD: 'Demand Draft' } })
    expect(resolveSystemOptions('participants', lookups)?.options).toEqual(['TCS'])
    expect(resolveSystemOptions('presales_lead', lookups)?.options).toEqual(['Asha'])
    expect(resolveSystemOptions('tender_fee_paid', lookups)?.options).toEqual(['Yes', 'No', 'NA'])
    expect(resolveSystemOptions('my_own_column', lookups)).toBeUndefined()
  })
  it('leaves ordinary custom fields untouched', () => {
    expect(withSystemOptions([{ key: 'mine', options: ['a'] }], lookups)).toEqual([{ key: 'mine', options: ['a'] }])
  })
})

describe('importing into built-in fields', () => {
  const field = (key: string, dataType: 'select' | 'multiselect', options: string[]) => ({ id: key, key, name: BID_SYSTEM_FIELDS.find(f => f.key === key)!.name, dataType, options })
  const ctx: BidTransferContext = { existing: [], people: [], states: [], departments: [], customFields: [
    field('emd_mode', 'multiselect', ['BG', 'DD', 'Online']), field('tender_fee_paid', 'select', ['Yes', 'No', 'NA']), field('zone', 'select', ['West']), field('bid_approval', 'select', ['Yes', 'No-Go', 'Under Approval']),
  ] }
  const run = (headers: string[], row: string[]) => validateBidTransfer({ headers, rows: [row] }, ctx)

  it('maps historical headers and splits multi-select cells', () => {
    const r = run(['Opportunity Name', 'Tender EMD in the Form Of', 'Zone'], ['Bid A', 'BG / DD', 'west'])
    expect(r.prepared[0].values['custom:emd_mode']).toBe('["BG","DD"]')
    expect(r.prepared[0].values['custom:zone']).toBe('West')
  })
  it('keeps NA as a real answer where the field offers it', () => {
    const r = run(['Opportunity Name', 'Tender Fee Paid (Yes/No/NA)'], ['Bid A', 'NA'])
    expect(r.prepared[0].values['custom:tender_fee_paid']).toBe('NA')
  })
  it('keeps Go/No Go separate from Bid Approval', () => {
    const r = run(['Opportunity Name', 'Bid Approval Received (Yes/No-Go /Under Approval)'], ['Bid A', 'Yes'])
    expect(r.prepared[0].values['custom:bid_approval']).toBe('Yes')
    expect(r.prepared[0].values.decision).toBeUndefined()
  })
})

describe('smart quarter', () => {
  it('uses the Indian financial year', async () => {
    const { financialQuarter, formatDateWithQuarter } = await import('./bidTrackerFields.js')
    expect(['2026-04-01', '2026-07-31', '2026-10-15', '2027-03-31'].map(financialQuarter)).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(formatDateWithQuarter('2026-10-15')).toBe('15/10/2026 (Q3)')
    expect(formatDateWithQuarter('')).toBe('')
  })
})

describe('timeline sync', () => {
  it('maps CXO flags and the LOA date both ways', async () => {
    const m = await import('./bidTrackerFields.js')
    const pre = m.timelineSyncForField('pre_cxo')!
    expect(m.milestoneStateForField(pre, 'Yes', '2026-10-19', null)).toEqual({ status: 'completed', dueAt: '2026-10-19' })
    expect(m.milestoneStateForField(pre, 'No', '2026-10-19', '2026-09-01')).toEqual({ status: 'open', dueAt: '2026-09-01' })
    expect(m.fieldValueForMilestone(pre, 'completed', null)).toBe('Yes')
    const loa = m.timelineSyncForMilestone('sales:workOrderReceived')!
    expect(m.milestoneStateForField(loa, '2026-11-02', 'x', null)).toEqual({ status: 'completed', dueAt: '2026-11-02' })
    expect(m.fieldValueForMilestone(loa, 'open', '2026-11-02')).toBeNull()
  })
})

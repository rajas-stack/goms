import { describe, expect, it } from 'vitest'
import { normalizeBidMobile, validateBidTransfer, type BidImportTable, type BidTransferContext } from './bidTransfer.js'

const context: BidTransferContext = {
  existing: [{ opportunityName: 'Live bid', gemTenderId: 'GEM/1' }],
  people: [{ id: 'sales-1', name: 'Sales Owner', email: 'owner@example.com', mobile: '9876543210', team: 'sales' }, { id: 'pre-1', name: 'Pre Owner', team: 'preSales' }],
  states: [{ id: '24', name: 'Gujarat' }], departments: [{ id: 'dept-1', name: 'Client', stateCode: 24 }],
  customFields: [{ id: 'phone', key: 'mobile', name: 'Mobile Number', dataType: 'phone' }],
}
const check = (headers: string[], ...rows: BidImportTable['rows']) => validateBidTransfer({ headers, rows }, context)

describe('safe bid import validation', () => {
  it('accepts new department agnostic bids and normalizes known fields', () => {
    const p = check(['Opportunity Name', 'RFP Published Date (DD/MM/YYYY)', 'Geo Sales Owner', 'State', 'Mobile Number'], [' New bid ', '19/10/2026', '+91 98765 43210', 'Gujarat', '09876543210'])
    expect(p.issues).toEqual([])
    expect(p.prepared[0].values).toMatchObject({ opportunityName: 'New bid', publishDate: '2026-10-19', geoSalesPersonId: 'sales-1', stateCode: 24, 'custom:mobile': '9876543210' })
    expect(p.prepared[0].values.departmentId).toBeUndefined()
    expect(p.changes.length).toBeGreaterThan(0)
  })
  it.each(['+91 98765 43210', '00919876543210', '919876543210', '09876543210', '9876543210'])('normalizes only explicit supported mobile formatting: %s', input => expect(normalizeBidMobile(input)).toBe('9876543210'))
  it.each(['1234567890', '1119876543210', '+449876543210', '987654321', '98765432101', '98letters76543210'])('rejects unknown mobile conditions: %s', input => expect(normalizeBidMobile(input)).toBeNull())
  it('rejects the whole file when even the last row is invalid', () => {
    const p = check(['Opportunity Name', 'RFP Published Date'], ['Good bid', '20/10/2026'], ['Bad bid', '31/02/2026'])
    expect(p.valid).toBe(false); expect(p.prepared).toEqual([])
    expect(p.issues).toContainEqual(expect.objectContaining({ row: 3, column: 1 }))
  })
  it.each([
    [['Opportunity Name'], ['Live bid']],
    [['Opportunity Name', 'Tender ID'], ['New bid', 'gem/1']],
    [['Opportunity Name', 'Opportunity Name'], ['One', 'Two']],
    [['Opportunity Name', 'Unknown column'], ['New', 'value']],
    [['Opportunity Name', 'SBU'], ['New', 'unmapped value']],
    [['Opportunity Name', 'Geo Sales Owner'], ['New', 'Pre Owner']],
    [['Opportunity Name', 'Tender Stage'], ['New', 'Won']],
    [['Opportunity Name', 'Opportunity Type'], ['New', 'invalid']],
    [['Opportunity Name', 'Go/No Go'], ['New', 'Go']],
    [['Opportunity Name', 'PQ Compliance'], ['New', 'maybe']],
  ])('rejects duplicates, unknown mappings and invalid app values %#', (...input) => {
    const [headers, row] = input as string[][]
    const p = check(headers, row)
    expect(p.valid).toBe(false); expect(p.prepared).toEqual([]); expect(p.issues.length).toBeGreaterThan(0)
  })
  it('catches duplicates within a file and never mutates reference data', () => {
    const before = structuredClone(context)
    expect(check(['Opportunity Name'], ['Same'], [' same ']).valid).toBe(false)
    expect(context).toEqual(before)
  })
  it('keeps malformed/formula cells rejected at the server boundary', () => {
    const p = validateBidTransfer({ headers: ['Opportunity Name'], rows: [['New bid']], cellIssues: [{ row: 2, column: 0, message: 'Formula' }] }, context)
    expect(p.valid).toBe(false); expect(p.prepared).toEqual([])
    expect(check(['Opportunity Name'], ['=CONCAT("New")']).valid).toBe(false)
  })
  it('validates hours, minutes and seconds in date/time fields', () => {
    const headers = ['Opportunity Name', 'Query Submission (As per RFP)']
    expect(check(headers, ['New', '2026-10-19T23:59:59']).valid).toBe(true)
    for (const time of ['24:00:00', '12:60:00', '12:30:60', '12:30:99']) {
      const preview = check(headers, ['New', `2026-10-19T${time}`])
      expect(preview.valid).toBe(false); expect(preview.prepared).toEqual([])
    }
  })
})

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { bidTemplate, exportGridWorkbook, failedBidReport, parseBidWorkbook } from './workbooks'
import { NO_LOOKUPS, resolveColumns } from '../gridColumns'
import type { BidGridRow } from '@/lib/types'

describe('bid transfer workbooks', () => {
  it('provides the requested 58 import columns and honest app mapping rules', () => {
    const wb = XLSX.read(bidTemplate(), { type: 'array' })
    const table = parseBidWorkbook(bidTemplate().buffer as ArrayBuffer)
    expect(table.headers).toHaveLength(58)
    expect(wb.SheetNames).toEqual(['Bids', 'Fields', 'Instructions'])
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Fields, { header: 1 })).toContainEqual(expect.arrayContaining(['SBU', '', 'Unmapped']))
  })
  it('preserves leading zero text, marks formulas, and refuses ambiguous dates', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['Opportunity Name', 'RFP Published Date', 'Tender ID'], ['New', 45000, '0012']])
    ws.A2.f = 'CONCAT("New")'
    XLSX.utils.book_append_sheet(wb, ws, 'Bids')
    const p = parseBidWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    expect(p.rows[0][2]).toBe('0012')
    expect(p.cellIssues).toEqual(expect.arrayContaining([expect.objectContaining({ row: 2, column: 0 }), expect.objectContaining({ row: 2, column: 1 })]))
  })
  it('exports hidden app columns and records with Yes/No visibility', () => {
    const columns = resolveColumns([])
    const row = { id: 'bid1', opportunityName: 'Original', valueAmount: '0.123456789012345', sheet: 'bidTracker', customValues: {}, generalValues: {}, archivedAt: '2026-10-01' } as unknown as BidGridRow
    const wb = XLSX.read(exportGridWorkbook([row], columns, new Set(['opportunityName']), NO_LOOKUPS), { type: 'array' })
    const fields = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Fields, { header: 1 })
    expect(fields).toContainEqual(['opportunityName', 'Opportunity / Mission', 'Yes', 'text'])
    expect(fields).toContainEqual(expect.arrayContaining(['departmentName', 'Department / Client', 'No']))
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Bids, { header: 1 })[1]).toContain('Original')
    const data = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Bids, { header: 1 })
    expect(data[1][data[0].indexOf('Record: valueAmount')]).toBe('0.123456789012345')
    expect(fields).toContainEqual(['record:archivedAt', 'archivedAt', 'No', 'Record metadata'])
  })
  it('writes actual red fills, per-cell comments and an Errors sheet', () => {
    const data = failedBidReport({ headers: ['Opportunity Name', 'Date'], rows: [['New', 'bad']] }, { valid: false, rowCount: 1, issues: [{ row: 2, column: 1, message: 'Invalid calendar date' }], changes: [], prepared: [] })
    const wb = XLSX.read(data, { type: 'array', cellStyles: true })
    expect(wb.Sheets['Rejected Bids'].B2.s.fgColor.rgb).toBe('FFC7CE')
    expect(wb.Sheets['Rejected Bids'].B2.c?.[0].t).toBe('Invalid calendar date')
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Errors, { header: 1 })[1]).toEqual([2, 'Date', 'Invalid calendar date'])
  })
  it('preserves monetary precision instead of exporting rounded display currency', () => {
    const row = { valueAmount: '0.123456789012345' } as BidGridRow
    const wb = XLSX.read(exportGridWorkbook([row], [{ id: 'valueAmount', header: 'Amount', group: 'custom', type: 'currency' }], new Set(), NO_LOOKUPS), { type: 'array' })
    expect(wb.Sheets.Bids.A2.v).toBe('0.123456789012345')
  })
})

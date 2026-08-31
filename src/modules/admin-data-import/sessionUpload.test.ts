import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { extractSheetsFromFile, buildSessionDomains } from './sessionUpload'

function bufferFrom(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  for (const [title, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), title)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

describe('extractSheetsFromFile', () => {
  it('extracts every non-blank sheet with its detection result', () => {
    const buffer = bufferFrom({ 'Tax Classes': [['Code', 'Name', 'Rate %'], ['GST18', 'GST 18%', 18]] })
    const sheets = extractSheetsFromFile('taxes.xlsx', buffer)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].detection).toEqual({ kind: 'matched', domain: 'taxClasses', sheetTitle: 'Tax Classes' })
    expect(sheets[0].rows).toEqual([{ code: 'GST18', name: 'GST 18%', ratePct: 18 }])
  })

  it('drops entirely-blank trailing rows', () => {
    const buffer = bufferFrom({ 'Tax Classes': [['Code', 'Name', 'Rate %'], ['GST18', 'GST 18%', 18], ['', '', '']] })
    expect(extractSheetsFromFile('taxes.xlsx', buffer)[0].rows).toHaveLength(1)
  })
})

describe('buildSessionDomains', () => {
  it('groups a single-sheet domain\'s rows, concatenating across files assigned to the same domain', () => {
    const sheets = [
      { id: 'a', fileName: 'f1.xlsx', sheetTitle: 'Tax Classes', headers: [], rows: [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }], detection: { kind: 'matched', domain: 'taxClasses', sheetTitle: 'Tax Classes' } },
      { id: 'b', fileName: 'f2.xlsx', sheetTitle: 'More Taxes', headers: [], rows: [{ code: 'GST28', name: 'GST 28%', ratePct: 28 }], detection: { kind: 'unrecognized' } },
    ] as const
    const assignments = new Map([
      ['a', { domain: 'taxClasses' as const, sheetTitle: 'Tax Classes' }],
      ['b', { domain: 'taxClasses' as const, sheetTitle: 'Tax Classes' }],
    ])
    const result = buildSessionDomains(sheets as any, assignments)
    expect(result.taxClasses).toEqual([{ code: 'GST18', name: 'GST 18%', ratePct: 18 }, { code: 'GST28', name: 'GST 28%', ratePct: 28 }])
  })

  it('routes a multi-sheet domain\'s sheet into its correct internal key', () => {
    const sheets = [
      { id: 'a', fileName: 'f1.xlsx', sheetTitle: 'Sales Persons', headers: [], rows: [{ officialEmail: 'a@b.com', name: 'A' }], detection: { kind: 'matched', domain: 'salesRoster', sheetTitle: 'Sales Persons' } },
    ] as const
    const assignments = new Map([['a', { domain: 'salesRoster' as const, sheetTitle: 'Sales Persons' }]])
    const result = buildSessionDomains(sheets as any, assignments)
    expect(result.salesRoster).toEqual({ persons: [{ officialEmail: 'a@b.com', name: 'A' }] })
  })

  it('omits a sheet with no assignment (excluded / not yet confirmed)', () => {
    const sheets = [{ id: 'a', fileName: 'f1.xlsx', sheetTitle: 'Mystery', headers: [], rows: [{ x: 1 }], detection: { kind: 'unrecognized' } }] as const
    expect(buildSessionDomains(sheets as any, new Map())).toEqual({})
  })
})

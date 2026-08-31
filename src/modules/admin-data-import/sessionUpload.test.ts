import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { extractSheetsFromFile, buildSessionDomains, unresolvedRowsAreAllExcluded } from './sessionUpload'

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

describe('unresolvedRowsAreAllExcluded', () => {
  it('is false while a needs-review/reject row has no matching exclusion', () => {
    const previewRows = [
      { domain: 'employees' as const, rowNumber: 1, action: 'create' as const },
      { domain: 'employees' as const, rowNumber: 2, action: 'needs-review' as const },
    ]
    expect(unresolvedRowsAreAllExcluded(previewRows, [])).toBe(false)
  })

  it('is true once every needs-review/reject row has a matching exclusion (matched by domain + sheetKey + rowNumber)', () => {
    const previewRows = [
      { domain: 'employees' as const, rowNumber: 1, action: 'create' as const },
      { domain: 'employees' as const, rowNumber: 2, action: 'needs-review' as const },
    ]
    const excludedRows = [{ domain: 'employees' as const, rowNumber: 2, businessKey: 'X', reason: 'bad' }]
    expect(unresolvedRowsAreAllExcluded(previewRows, excludedRows)).toBe(true)
  })

  it('matches on sheetKey too, so an exclusion for one sheet never accidentally clears a same-numbered row in a different sheet of the same domain', () => {
    const previewRows = [
      { domain: 'salesRoster' as const, sheetKey: 'persons', rowNumber: 1, action: 'needs-review' as const },
      { domain: 'salesRoster' as const, sheetKey: 'postings', rowNumber: 1, action: 'reject' as const },
    ]
    const excludedRows = [{ domain: 'salesRoster' as const, sheetKey: 'persons', rowNumber: 1, businessKey: 'a@b.com', reason: 'bad' }]
    expect(unresolvedRowsAreAllExcluded(previewRows, excludedRows)).toBe(false) // the postings row is still unaccounted for
  })

  it('is true when there are no unresolved rows at all, regardless of exclusions', () => {
    const previewRows = [{ domain: 'taxClasses' as const, rowNumber: 1, action: 'create' as const }]
    expect(unresolvedRowsAreAllExcluded(previewRows, [])).toBe(true)
  })
})

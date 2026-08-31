import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { workbookToCsv } from './workbookToCsv'

function xlsxArrayBuffer(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('workbookToCsv', () => {
  it('converts a workbook\'s first sheet into CSV text, header row included', () => {
    const csv = workbookToCsv(xlsxArrayBuffer([
      ['Name', 'Type'],
      ['Finance Department', 'department'],
      ['Legal Cell', ''],
    ]))
    expect(csv.split('\r\n')).toEqual([
      'Name,Type',
      'Finance Department,department',
      'Legal Cell,',
    ])
  })

  it('quotes a cell containing a comma, matching splitCsvLine\'s reader', () => {
    const csv = workbookToCsv(xlsxArrayBuffer([
      ['Name', 'Designation'],
      ['Jane Doe', 'Deputy Director, Finance'],
    ]))
    expect(csv.split('\r\n')[1]).toBe('Jane Doe,"Deputy Director, Finance"')
  })

  it('reads only the first sheet when a workbook has several', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Name', 'Type'], ['First Sheet Dept', 'department']]), 'First')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Name', 'Type'], ['Second Sheet Dept', 'department']]), 'Second')
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const csv = workbookToCsv(buffer)
    expect(csv).toContain('First Sheet Dept')
    expect(csv).not.toContain('Second Sheet Dept')
  })

  it('returns an empty string for a sheet with no rows', () => {
    expect(workbookToCsv(xlsxArrayBuffer([]))).toBe('')
  })
})

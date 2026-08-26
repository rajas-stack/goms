import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { TEMPLATE_COLUMNS, HEADER_TO_FIELD, SPREADSHEET_DOMAIN_KEYS, parseCellValue, parseWorkbook, UnrecognizedWorkbookError } from './templates'

function workbookBuffer(sheets: { sheet: string; rows: unknown[][] }[]): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  for (const { sheet, rows } of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheet)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

describe('TEMPLATE_COLUMNS', () => {
  it('defines the exact Tax Classes columns from the design spec', () => {
    expect(TEMPLATE_COLUMNS.taxClasses).toEqual([
      { sheet: 'Tax Classes', columns: ['Code', 'Name', 'Description', 'Rate %', 'Active', 'Display Order'] },
    ])
  })

  it('defines two sheets for Sales Roster', () => {
    expect(TEMPLATE_COLUMNS.salesRoster.map((s) => s.sheet)).toEqual(['Sales Persons', 'Postings'])
  })

  it('defines four sheets for each multi-sheet Commercial Masters template', () => {
    expect(TEMPLATE_COLUMNS.commercialMastersFlat.map((s) => s.sheet)).toEqual([
      'SKU Categories', 'Units of Measure', 'Product Editions', 'Billing Types',
    ])
    expect(TEMPLATE_COLUMNS.commercialMastersCatalog.map((s) => s.sheet)).toEqual([
      'Verticals', 'Products', 'Modules', 'Features',
    ])
  })

  it('gives the Features sheet its extra Feature Status column, unlike the other catalog sheets', () => {
    const catalog = TEMPLATE_COLUMNS.commercialMastersCatalog
    expect(catalog.find((s) => s.sheet === 'Features')?.columns).toContain('Feature Status')
    expect(catalog.find((s) => s.sheet === 'Modules')?.columns).not.toContain('Feature Status')
  })

  it('has an entry for every spreadsheet domain, and none for geography', () => {
    expect(Object.keys(TEMPLATE_COLUMNS).sort()).toEqual([...SPREADSHEET_DOMAIN_KEYS].sort())
    expect(Object.keys(TEMPLATE_COLUMNS)).not.toContain('geography')
  })

  it('maps every declared column of every sheet to a field name', () => {
    for (const [domain, sheets] of Object.entries(TEMPLATE_COLUMNS)) {
      for (const { sheet, columns } of sheets) {
        for (const column of columns) {
          expect(HEADER_TO_FIELD[column], `${domain}/${sheet} column "${column}"`).toBeTruthy()
        }
      }
    }
  })
})

describe('parseCellValue', () => {
  it('coerces Y/N and true/false spellings for boolean fields', () => {
    expect(parseCellValue('active', 'Y')).toBe(true)
    expect(parseCellValue('active', 'no')).toBe(false)
    expect(parseCellValue('isBaseCurrency', true)).toBe(true)
  })

  it('coerces numeric fields from spreadsheet strings', () => {
    expect(parseCellValue('ratePct', '18')).toBe(18)
    expect(parseCellValue('displayOrder', '')).toBe(undefined)
  })

  it('leaves a non-numeric value in a numeric field alone so the backend rejects it with a real message', () => {
    expect(parseCellValue('ratePct', 'eighteen')).toBe('eighteen')
  })

  it('passes string fields through, trimmed', () => {
    expect(parseCellValue('name', '  GST 18%  ')).toBe('GST 18%')
  })
})

describe('parseWorkbook', () => {
  it('maps a single-sheet workbook onto the importer field names', () => {
    const buffer = workbookBuffer([
      { sheet: 'Tax Classes', rows: [TEMPLATE_COLUMNS.taxClasses[0].columns, ['GST18', 'GST 18%', '', '18', 'Y', '0']] },
    ])
    expect(parseWorkbook('taxClasses', buffer)).toEqual([
      { code: 'GST18', name: 'GST 18%', description: '', ratePct: 18, active: true, displayOrder: 0 },
    ])
  })

  it('maps a multi-sheet workbook onto the importer sheet keys, not the human sheet titles', () => {
    const buffer = workbookBuffer([
      { sheet: 'Sales Persons', rows: [TEMPLATE_COLUMNS.salesRoster[0].columns, ['a@x.com', 'Asha', '', '', '', '', 'active']] },
      { sheet: 'Postings', rows: [TEMPLATE_COLUMNS.salesRoster[1].columns, ['a@x.com', 'AM', 'am', '', 'Pune', '2026-01-01', '']] },
    ])
    const rows = parseWorkbook('salesRoster', buffer) as Record<string, unknown[]>
    expect(Object.keys(rows)).toEqual(['persons', 'postings'])
    expect(rows.persons).toHaveLength(1)
    expect(rows.postings[0]).toMatchObject({ salesPersonEmail: 'a@x.com', tierKey: 'am', startDate: '2026-01-01' })
  })

  it('drops entirely-blank rows so a template\'s trailing empty rows are not rejected rows', () => {
    const buffer = workbookBuffer([
      { sheet: 'Tax Classes', rows: [TEMPLATE_COLUMNS.taxClasses[0].columns, ['GST18', 'GST 18%', '', '18', 'Y', '0'], ['', '', '', '', '', '']] },
    ])
    expect(parseWorkbook('taxClasses', buffer)).toHaveLength(1)
  })

  it('rejects a workbook carrying none of this domain\'s columns, rather than silently parsing zero rows', () => {
    const buffer = workbookBuffer([{ sheet: 'Sheet1', rows: [['Something Else Entirely'], ['x']] }])
    expect(() => parseWorkbook('taxClasses', buffer)).toThrow(UnrecognizedWorkbookError)
  })

  it('accepts a correctly-headed but data-empty template, unlike an unrecognized workbook', () => {
    const buffer = workbookBuffer([{ sheet: 'Tax Classes', rows: [TEMPLATE_COLUMNS.taxClasses[0].columns] }])
    expect(parseWorkbook('taxClasses', buffer)).toEqual([])
  })

  it('returns empty rows for a sheet the uploaded workbook omits entirely', () => {
    const buffer = workbookBuffer([
      { sheet: 'Sales Persons', rows: [TEMPLATE_COLUMNS.salesRoster[0].columns, ['a@x.com', 'Asha', '', '', '', '', 'active']] },
    ])
    const rows = parseWorkbook('salesRoster', buffer) as Record<string, unknown[]>
    expect(rows.postings).toEqual([])
  })
})

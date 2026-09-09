import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { sheetHeaders, rowsFromSheet, parseWorkbook, UnrecognizedWorkbookError } from './templates'
import { detectDomainForSheet } from './domainDetection'
import { extractSheetsFromFile } from './sessionUpload'

// 2026-09: a real production admin upload had a merged report title and an
// explanatory note above the real header row on every sheet. The importer
// unconditionally treated row 1 as the header (a bare `sheet_to_json` call,
// no header-row search), so every sheet silently parsed to zero usable rows
// — nothing was created, but the feature was unusable for any realistically-
// formatted export. This file locks in the fix: header-row auto-detection
// (by content, scanning the whole sheet) and domain detection driven by
// header signature rather than sheet tab name.

function workbookBuffer(sheets: { sheet: string; rows: unknown[][] }[]): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  for (const { sheet, rows } of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheet)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

const ORG_HEADER = ['Type', 'Name', 'Code', 'Parent Code', 'State Code', 'Status']

describe('header-row auto-detection', () => {
  it('finds the header below a title row, a note row, and a blank row', () => {
    const buffer = workbookBuffer([
      {
        sheet: 'Organization Structure',
        rows: [
          ['QA test data only — do not treat as real records'],
          ['This workbook exercises header-row detection.'],
          [],
          ORG_HEADER,
          ['department', 'Transport & Mobility', 'QAIMP-DEPT-TM', '', '', 'active'],
        ],
      },
    ])
    expect(sheetHeaders(workbookSheet(buffer, 'Organization Structure'))).toEqual(ORG_HEADER)
    const rows = rowsFromSheet(workbookSheet(buffer, 'Organization Structure'), 'organizationHierarchy')
    expect(rows).toEqual([{ nodeType: 'department', name: 'Transport & Mobility', code: 'QAIMP-DEPT-TM', parentCode: '', status: 'active' }])
  })

  it('still works when the header is on row 1 (no title/note above it)', () => {
    const buffer = workbookBuffer([{ sheet: 'Organization Hierarchy', rows: [ORG_HEADER, ['unit', 'Test Unit', 'U1', '', '', 'active']] }])
    const rows = rowsFromSheet(workbookSheet(buffer, 'Organization Hierarchy'), 'organizationHierarchy')
    expect(rows).toEqual([{ nodeType: 'unit', name: 'Test Unit', code: 'U1', parentCode: '', status: 'active' }])
  })

  it('ignores extra, unrecognized export columns without rejecting the sheet', () => {
    const buffer = workbookBuffer([
      {
        sheet: 'Export',
        rows: [
          ['Official Email', 'Full Name', 'Alternate Email', 'Source System'],
          ['a@x.com', 'Asha', 'a.alt@x.com', 'Internal Ref'],
        ],
      },
    ])
    const rows = rowsFromSheet(workbookSheet(buffer, 'Export'), 'salesRoster')
    expect(rows).toEqual([{ officialEmail: 'a@x.com', name: 'Asha' }])
  })

  it('never lets title/note/legend text become a parsed data row', () => {
    const buffer = workbookBuffer([
      {
        sheet: 'Organization Structure',
        rows: [
          ['QA test data only. This workbook uses business-friendly headers.'],
          [],
          ORG_HEADER,
          ['department', 'Transport & Mobility', 'QAIMP-DEPT-TM', '', '', 'active'],
        ],
      },
    ])
    const rows = rowsFromSheet(workbookSheet(buffer, 'Organization Structure'), 'organizationHierarchy')
    expect(rows).toHaveLength(1)
    const values = rows.flatMap((r) => Object.values(r))
    expect(values.some((v) => typeof v === 'string' && v.includes('QA test data only'))).toBe(false)
    expect(values).not.toContain('Type') // the header row's own cells must never appear as a data value
  })

  it('reports unrecognized (zero rows) for a sheet with only a title/legend and no real header anywhere', () => {
    const buffer = workbookBuffer([
      { sheet: 'Organization Structure', rows: [['QA test data only'], ['department'], ['branch'], ['office'], ['unit']] },
    ])
    const ws = workbookSheet(buffer, 'Organization Structure')
    expect(rowsFromSheet(ws, 'organizationHierarchy')).toEqual([])
    expect(() => parseWorkbook('organizationHierarchy', buffer)).toThrow(UnrecognizedWorkbookError)
  })
})

describe('domain detection by content, not sheet tab name', () => {
  it('recognizes a renamed, business-friendly sheet title purely from header content', () => {
    const result = detectDomainForSheet('Organization Structure', ['Type', 'Organization Name', 'Org Code', 'Parent Org Code', 'State Code', 'Status'])
    expect(result).toEqual({ kind: 'matched', domain: 'organizationHierarchy', sheetTitle: 'Organization Hierarchy' })
  })

  it('recognizes a renamed Employees sheet using natural-language aliases', () => {
    const result = detectDomainForSheet('People', ['Employee No', 'Employee Name', 'Job Title', 'Work Email', 'Department Code'])
    expect(result).toEqual({ kind: 'matched', domain: 'employees', sheetTitle: 'Employees' })
  })

  it('resolves "Org Code" to the node\'s own code for organizationHierarchy, not the employees orgNodeCode meaning', () => {
    const buffer = workbookBuffer([
      { sheet: 'Organization Structure', rows: [['Type', 'Organization Name', 'Org Code', 'Parent Org Code', 'State Code', 'Status'], ['department', 'Transport', 'QAIMP-DEPT-TM', '', '', 'active']] },
    ])
    const rows = rowsFromSheet(workbookSheet(buffer, 'Organization Structure'), 'organizationHierarchy')
    expect(rows[0]).toMatchObject({ code: 'QAIMP-DEPT-TM' })
    expect(rows[0]).not.toHaveProperty('orgNodeCode')
  })

  it('resolves "Work Email" to an employee\'s own email, not salesRoster\'s officialEmail meaning', () => {
    const buffer = workbookBuffer([
      { sheet: 'People', rows: [['Employee No', 'Employee Name', 'Job Title', 'Work Email', 'Department Code'], ['E1', 'Neha', 'Head', 'neha@x.com', 'DEPT1']] },
    ])
    const rows = rowsFromSheet(workbookSheet(buffer, 'People'), 'employees')
    expect(rows[0]).toMatchObject({ email: 'neha@x.com' })
    expect(rows[0]).not.toHaveProperty('officialEmail')
  })

  it('still trusts an exact tab-name match for a clean template sheet', () => {
    const result = detectDomainForSheet('Tax Classes', ['Code', 'Name', 'Description', 'Rate %', 'Active', 'Display Order'])
    expect(result).toEqual({ kind: 'matched', domain: 'taxClasses', sheetTitle: 'Tax Classes' })
  })

  it('reports ambiguous, not a confident guess, for a combined multi-level sheet that mixes several sibling sub-sheets together', () => {
    // A single "Level"-discriminated sheet mixing vertical/product/module/feature
    // rows is not a shape the app supports (it expects 4 separate sheets) —
    // it must never be silently and confidently assigned to just one sibling.
    const result = detectDomainForSheet('Commercial Catalog', ['Level', 'Name', 'Code', 'Parent Code', 'Status', 'Feature Status', 'Display Order'])
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates.length).toBeGreaterThan(1)
      expect(result.candidates.every((c) => c.domain === 'commercialMastersCatalog')).toBe(true)
    }
  })

  it('still requires user resolution for a genuinely ambiguous sheet (no title match to disambiguate)', () => {
    const result = detectDomainForSheet('Sheet1', ['Code', 'Name'])
    expect(result.kind).toBe('ambiguous')
  })

  it('still reports unrecognized for a sheet with no recognizable header anywhere', () => {
    const result = detectDomainForSheet('Notes', ['Foo', 'Bar'])
    expect(result.kind).toBe('unrecognized')
  })
})

function workbookSheet(buffer: ArrayBuffer, sheetTitle: string): XLSX.WorkSheet {
  const workbook = XLSX.read(buffer, { type: 'array' })
  return workbook.Sheets[sheetTitle]
}

const COMBINED_CATALOG_HEADER = ['Level', 'Name', 'Code', 'Parent Code', 'Active', 'Display Order']

describe('combined Commercial Catalog sheet (Level discriminator)', () => {
  it('splits a single Level-discriminated sheet into all four real catalog sheets, correctly matched', () => {
    const buffer = workbookBuffer([
      {
        sheet: 'Commercial Catalog',
        rows: [
          COMBINED_CATALOG_HEADER,
          ['Vertical', 'Digital Infrastructure', 'V-INFRA', '', 'TRUE', 10],
          ['Product', 'GovCloud Platform', 'P-CLOUD', 'V-INFRA', 'TRUE', 10],
          ['Module', 'Observability', 'M-OBS', 'P-CLOUD', 'TRUE', 10],
          ['Feature', 'Service Monitoring', 'F-MON', 'M-OBS', 'TRUE', 10],
        ],
      },
    ])
    const detected = extractSheetsFromFile('catalog.xlsx', buffer)
    const byTitle = new Map(detected.map((s) => [s.sheetTitle, s]))

    expect(byTitle.get('Verticals')!.detection).toEqual({ kind: 'matched', domain: 'commercialMastersCatalog', sheetTitle: 'Verticals' })
    expect(byTitle.get('Verticals')!.rows).toEqual([{ name: 'Digital Infrastructure', code: 'V-INFRA', parentCode: '', active: true, displayOrder: 10 }])
    expect(byTitle.get('Products')!.rows).toEqual([{ name: 'GovCloud Platform', code: 'P-CLOUD', parentCode: 'V-INFRA', active: true, displayOrder: 10 }])
    expect(byTitle.get('Modules')!.rows).toEqual([{ name: 'Observability', code: 'M-OBS', parentCode: 'P-CLOUD', active: true, displayOrder: 10 }])
    expect(byTitle.get('Features')!.rows).toEqual([{ name: 'Service Monitoring', code: 'F-MON', parentCode: 'M-OBS', active: true, displayOrder: 10 }])
    // Decomposed fully — no leftover combined-sheet or invalid-level entry.
    expect(detected.some((s) => s.sheetTitle === 'Commercial Catalog')).toBe(false)
    expect(detected.some((s) => s.sheetTitle.includes('invalid Level'))).toBe(false)
  })

  it('matches Level values case-insensitively, same as every other enum-like value', () => {
    const buffer = workbookBuffer([
      { sheet: 'Catalog', rows: [COMBINED_CATALOG_HEADER, ['VERTICAL', 'Digital Infrastructure', 'V-INFRA', '', 'TRUE', 10]] },
    ])
    const detected = extractSheetsFromFile('catalog.xlsx', buffer)
    expect(detected.find((s) => s.sheetTitle === 'Verticals')!.rows).toHaveLength(1)
  })

  it('clearly flags rows with an invalid Level value instead of silently dropping or misassigning them', () => {
    const buffer = workbookBuffer([
      {
        sheet: 'Catalog',
        rows: [
          COMBINED_CATALOG_HEADER,
          ['Vertical', 'Digital Infrastructure', 'V-INFRA', '', 'TRUE', 10],
          ['Division', 'Bogus Level Row', 'BAD-1', '', 'TRUE', 10],
          ['', 'Blank Level Row', 'BAD-2', '', 'TRUE', 10],
        ],
      },
    ])
    const detected = extractSheetsFromFile('catalog.xlsx', buffer)
    const flagged = detected.find((s) => s.sheetTitle.includes('invalid Level'))
    expect(flagged).toBeDefined()
    expect(flagged!.detection.kind).toBe('unrecognized')
    expect(flagged!.rows).toHaveLength(2)
    expect(flagged!.sheetTitle).toContain('Division')
    expect(flagged!.sheetTitle).toContain('(blank)')
    // The one genuinely valid row still gets through, unaffected by its
    // invalid siblings.
    expect(detected.find((s) => s.sheetTitle === 'Verticals')!.rows).toHaveLength(1)
  })

  it('does not misidentify an ordinary sheet with an unrelated "Level" word as a combined catalog sheet', () => {
    // Approval Matrix uses "Approval Level" (a different header entirely,
    // not the exact "Level" spelling) alongside its own Code/Name — must
    // not be mistaken for a combined catalog export.
    const result = extractSheetsFromFile('x.xlsx', workbookBuffer([
      { sheet: 'Approval Matrix', rows: [['Code', 'Name', 'Approval Level'], ['AM1', 'Tier 1', '5']] },
    ]))
    expect(result.some((s) => ['Verticals', 'Products', 'Modules', 'Features'].includes(s.sheetTitle))).toBe(false)
  })

  it('re-extracting the identical workbook produces identical rows — a prerequisite for idempotent re-upload', () => {
    const buffer = workbookBuffer([
      { sheet: 'Commercial Catalog', rows: [COMBINED_CATALOG_HEADER, ['Vertical', 'Digital Infrastructure', 'V-INFRA', '', 'TRUE', 10]] },
    ])
    const first = extractSheetsFromFile('catalog.xlsx', buffer)
    const second = extractSheetsFromFile('catalog.xlsx', buffer)
    expect(second.find((s) => s.sheetTitle === 'Verticals')!.rows).toEqual(first.find((s) => s.sheetTitle === 'Verticals')!.rows)
  })
})

describe('real-world workbook regression (GovCore_Excel_Import_QA_Test.xlsx)', () => {
  const FIXTURE = path.join(__dirname, '__fixtures__', 'GovCore_Excel_Import_QA_Test.xlsx')

  function loadFixtureBuffer(): ArrayBuffer {
    const buf = fs.readFileSync(FIXTURE)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  it('detects the correct domain for every renamed sheet, purely from content', () => {
    const detected = extractSheetsFromFile('GovCore_Excel_Import_QA_Test.xlsx', loadFixtureBuffer())
    const byTitle = new Map(detected.map((s) => [s.sheetTitle, s]))

    expect(byTitle.get('Organization Structure')?.detection).toEqual({ kind: 'matched', domain: 'organizationHierarchy', sheetTitle: 'Organization Hierarchy' })
    expect(byTitle.get('People')?.detection).toEqual({ kind: 'matched', domain: 'employees', sheetTitle: 'Employees' })
    expect(byTitle.get('Sales Team')?.detection).toEqual({ kind: 'matched', domain: 'salesRoster', sheetTitle: 'Sales Persons' })
    expect(byTitle.get('Sales Assignments')?.detection).toEqual({ kind: 'matched', domain: 'salesRoster', sheetTitle: 'Postings' })
    expect(byTitle.get('Tax Classes')?.detection).toEqual({ kind: 'matched', domain: 'taxClasses', sheetTitle: 'Tax Classes' })
    expect(byTitle.get('Currencies')?.detection).toEqual({ kind: 'matched', domain: 'currencies', sheetTitle: 'Currencies' })
    expect(byTitle.get('SKU Master')?.detection).toEqual({ kind: 'matched', domain: 'skus', sheetTitle: 'SKUs' })
    expect(byTitle.get('Bill of Materials')?.detection).toEqual({ kind: 'matched', domain: 'bom', sheetTitle: 'BOM' })
    // The combined Level-discriminated catalog sheet is automatically
    // decomposed into its four real sheets, each pre-matched — not left as
    // one ambiguous blob requiring a manual split.
    expect(byTitle.get('Verticals')?.detection).toEqual({ kind: 'matched', domain: 'commercialMastersCatalog', sheetTitle: 'Verticals' })
    expect(byTitle.get('Products')?.detection).toEqual({ kind: 'matched', domain: 'commercialMastersCatalog', sheetTitle: 'Products' })
    expect(byTitle.get('Modules')?.detection).toEqual({ kind: 'matched', domain: 'commercialMastersCatalog', sheetTitle: 'Modules' })
    expect(byTitle.get('Features')?.detection).toEqual({ kind: 'matched', domain: 'commercialMastersCatalog', sheetTitle: 'Features' })
    expect(byTitle.get('Commercial Catalog')).toBeUndefined() // fully decomposed, no leftover combined-sheet entry
    // Pure prose: still surfaced to the admin (for manual skip/assignment)
    // but must never auto-match any domain, and must parse zero rows.
    expect(byTitle.get('README')?.detection).toEqual({ kind: 'unrecognized' })
    expect(byTitle.get('README')?.rows).toEqual([])
  })

  it('extracts exactly the intended data rows for each sheet — no title/note/legend text leaks in', () => {
    const detected = extractSheetsFromFile('GovCore_Excel_Import_QA_Test.xlsx', loadFixtureBuffer())
    const byTitle = new Map(detected.map((s) => [s.sheetTitle, s]))

    const org = byTitle.get('Organization Structure')!
    expect(org.rows).toHaveLength(5)
    expect(org.rows.map((r) => r.code)).toEqual(['QAIMP-DEPT-TM', 'QAIMP-UNIT-UTP', 'QAIMP-BRANCH-STS', 'QAIMP-OFFICE-MUM', 'QAIMP-OFFICE-PUN'])

    const people = byTitle.get('People')!
    expect(people.rows).toHaveLength(5)
    expect(people.rows.map((r) => r.employeeCode)).toEqual(['QAIMP-E001', 'QAIMP-E002', 'QAIMP-E003', 'QAIMP-E004', 'QAIMP-E005'])
    // QAIMP-E004 is the genuine vacant-seat row: blank name, Is Vacant=Yes.
    expect(people.rows[3]).toMatchObject({ vacant: true, name: '' })

    const salesPersons = byTitle.get('Sales Team')!
    expect(salesPersons.rows).toHaveLength(2)
    const salesPostings = byTitle.get('Sales Assignments')!
    expect(salesPostings.rows).toHaveLength(2)

    const taxClasses = byTitle.get('Tax Classes')!
    expect(taxClasses.rows).toHaveLength(2)
    const currencies = byTitle.get('Currencies')!
    expect(currencies.rows).toHaveLength(2)

    const skus = byTitle.get('SKU Master')!
    expect(skus.rows).toHaveLength(2)
    const bom = byTitle.get('Bill of Materials')!
    expect(bom.rows).toHaveLength(1)

    // No sheet's parsed rows contain any fragment of the title/note prose.
    for (const sheet of detected) {
      const allValues = sheet.rows.flatMap((r) => Object.values(r))
      expect(allValues.some((v) => typeof v === 'string' && v.includes('QA test data only'))).toBe(false)
      expect(allValues.some((v) => typeof v === 'string' && v.startsWith('Recommended environment'))).toBe(false)
    }
  })

  it('decomposes the combined catalog sheet into all four levels with the right rows, and still flags README for manual resolution', () => {
    const detected = extractSheetsFromFile('GovCore_Excel_Import_QA_Test.xlsx', loadFixtureBuffer())
    const byTitle = new Map(detected.map((s) => [s.sheetTitle, s]))

    // Feature Status is a shared column on this combined sheet, so it's
    // extracted for every row regardless of level — harmless for
    // non-feature schemas, which simply don't declare that field.
    expect(byTitle.get('Verticals')!.rows).toEqual([{ name: 'Smart Infrastructure', code: 'QAIMP-V-SI', parentCode: '', status: 'Active', featureStatus: 'QA', displayOrder: 10 }])
    expect(byTitle.get('Products')!.rows).toEqual([{ name: 'Urban Mobility Platform', code: 'QAIMP-P-UMP', parentCode: 'QAIMP-V-SI', status: 'Active', featureStatus: 'QA', displayOrder: 20 }])
    expect(byTitle.get('Modules')!.rows).toEqual([{ name: 'Fleet Operations', code: 'QAIMP-M-FO', parentCode: 'QAIMP-P-UMP', status: 'Active', featureStatus: 'QA', displayOrder: 30 }])
    expect(byTitle.get('Features')!.rows).toHaveLength(2)
    expect(byTitle.get('Features')!.rows.map((r) => r.code)).toEqual(['QAIMP-F-RO', 'QAIMP-F-DF'])

    const readme = detected.find((s) => s.sheetTitle === 'README')!
    expect(readme.detection.kind).toBe('unrecognized')
    expect(readme.rows).toEqual([])
  })
})

import * as XLSX from 'xlsx'
import type { BidGridRow } from '@/lib/types'
import { cellValue, formatValueText, type GridColumnMeta, type EntityLookups } from '../gridColumns'
import { BID_FIELDS, BID_STAGES, bidTransferFields, resolveBidTransferField, findBidField, BID_IMPORT_MAX_COLUMNS, type BidImportTable, type BidImportPreview, type BidTransferContext } from '@goms/domain'

export const WORKBOOK_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const MAX_BID_FILE_BYTES = 5 * 1024 * 1024
export function parseBidWorkbook(data: ArrayBuffer): BidImportTable {
  const wb = XLSX.read(data, { type: 'array', raw: true, cellDates: false, cellFormula: true, cellNF: true, sheetRows: 1002 })
  const dataSheets = wb.SheetNames.filter(n => !['Fields', 'Instructions'].includes(n))
  if (dataSheets.length !== 1) throw new Error('Use one data sheet named Bids (or a single-sheet CSV). Only Fields and Instructions may accompany it as reference sheets.')
  const ws = wb.Sheets[dataSheets[0]]
  const ref = ws['!fullref'] ?? ws['!ref']
  if (!ref) throw new Error('The file has no header or data rows.')
  const range = XLSX.utils.decode_range(ref)
  // Starting somewhere other than A1 is ambiguous: never shift the column/row identities.
  if (range.s.r !== 0 || range.s.c !== 0) throw new Error('Place the header row at cell A1, with the data immediately below it.')
  if (range.e.r > 1000 || range.e.c >= BID_IMPORT_MAX_COLUMNS) throw new Error('The sheet is too large. Use at most 500 bids and 100 columns per batch; remove distant formatted cells.')
  const table: BidImportTable = { headers: [], rows: [], cellIssues: [] }
  for (let c = 0; c <= range.e.c; c++) table.headers.push(String(ws[XLSX.utils.encode_cell({ r: 0, c })]?.v ?? ''))
  for (let r = 0; r <= range.e.r; r++) {
    const row: (string | number | boolean | null)[] = []
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell?.f || cell?.t === 'e') table.cellIssues!.push({ row: r + 1, column: c, message: cell.f ? 'Formula cell. Paste the calculated value before importing.' : 'Spreadsheet error cell. Correct the source calculation or enter a value.' })
      let value = cell?.v ?? null
      if (r && typeof value === 'number' && (XLSX.SSF.is_date(cell.z ?? '') || findBidField(table.headers[c])?.kind === 'date')) {
        const d = XLSX.SSF.parse_date_code(value, { date1904: !!wb.Workbook?.WBProps?.date1904 })
        if (!XLSX.SSF.is_date(cell.z ?? '')) table.cellIssues!.push({ row: r + 1, column: c, message: 'Ambiguous numeric date without Excel date formatting. Enter DD/MM/YYYY or format the cell as a date.' })
        else if (!d || (d.y === 1900 && d.m === 2 && d.d === 29)) table.cellIssues!.push({ row: r + 1, column: c, message: 'Invalid Excel date or time value. Use a date in DD/MM/YYYY format.' })
        else value = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` + (value % 1 ? `T${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}:${String(d.S).padStart(2, '0')}` : '')
      }
      if (r && typeof value === 'number' && cell?.z?.replace(/"[^"]*"|\\./g, '').includes('%') && findBidField(table.headers[c])?.kind === 'percent') value *= 100
      row.push(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null)
    }
    if (r) table.rows.push(row)
  }
  return table
}

const write = (wb: XLSX.WorkBook) => new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }))
const append = (wb: XLSX.WorkBook, name: string, rows: unknown[][]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = (rows[0] ?? []).map(() => ({ wch: 26 }))
  XLSX.utils.book_append_sheet(wb, ws, name)
  return ws
}

export function exportGridWorkbook(rows: BidGridRow[], columns: GridColumnMeta[], visible: ReadonlySet<string>, lookups: EntityLookups): Uint8Array {
  const wb = XLSX.utils.book_new()
  const extra = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(key => !columns.some(c => c.id === key) && !['customValues', 'generalValues'].includes(key)).sort()
  const text = (value: unknown) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  append(wb, 'Bids', [[...columns.map(c => c.header), ...extra.map(key => `Record: ${key}`)], ...rows.map(row => [
    ...columns.map(c => c.type === 'currency' ? text(cellValue(row, c)) : formatValueText(c, cellValue(row, c), lookups)), ...extra.map(key => text((row as unknown as Record<string, unknown>)[key])),
  ])])
  append(wb, 'Fields', [['Field ID', 'Field', 'Visible on Bid Tracker', 'Type'], ...columns.map(c => [c.id, c.header, visible.has(c.id) ? 'Yes' : 'No', c.type ?? 'Read only']), ...extra.map(key => [`record:${key}`, key, 'No', 'Record metadata'])])
  append(wb, 'Instructions', [['Instructions'], ['All Bid Tracker rows and fields are exported, including archived rows and hidden columns. Search and saved-view filters do not limit this export.'], ['Fields lists the current column visibility as Yes or No. Use the import template for NEW bids; existing rows and generated/read-only fields are not overwritten by import.']])
  return write(wb)
}

export function bidTemplate(context: BidTransferContext = { existing: [], people: [], states: [], departments: [], customFields: [] }): Uint8Array {
  const wb = XLSX.utils.book_new()
  const fields = bidTransferFields(context)
  append(wb, 'Bids', [BID_FIELDS.map(f => f.label)])
  append(wb, 'Fields', [['Spreadsheet field', 'App field ID', 'Type', 'Accepted values / rule', 'Required'], ...BID_FIELDS.map(f => {
    const target = resolveBidTransferField(f.label, fields)
    return [f.label, target?.id ?? '', target?.type ?? 'Unmapped', target ? target.options?.join(' / ') ?? 'Validated against the existing app field' : f.kind === 'serial' ? 'Optional row number' : 'Leave blank, or map to an existing custom field with this name. Populated unmapped fields reject the batch.', f.required ? 'Yes' : 'No']
  }), ...fields.map(f => [f.label, f.id, f.type, f.options?.join(' / ') ?? 'Use this field ID as a column header', f.id === 'opportunityName' ? 'Yes' : 'No'])])
  append(wb, 'Instructions', [['Instructions'],
    ['Opportunity Name is required. Other blank fields are accepted as missing details. No department is required.'],
    ['Dates: DD/MM/YYYY or YYYY-MM-DD. Tender Value: INR crore, excluding tax. Tender Fee and Tender EMD: INR rupees.'],
    ['Percentages: 0–100. Owners: existing active sales-roster name, official email, ID or Indian mobile. No new owners are created.'],
    ['Only values are accepted, not formulas. Unknown columns, duplicates and invalid values reject the entire batch.'],
    ['The Fields sheet shows mappings to existing app fields. Populated unmapped fields reject the batch; no columns or master records are created automatically.'],
    [`Bid stages: ${BID_STAGES.map(s => s.key).join(', ')}. Compliance and submission choices must match the current app options in Fields.`],
    ['Quarter: Q1–Q4, optionally with a year. One data sheet only. Maximum 500 bids / 5 MB per batch.'],
    ['Review the sideload preview and normalized values before adding the whole batch. Existing bids are never overwritten.'],
  ])
  return write(wb)
}

/** Add a red cell style using SheetJS's bundled ZIP support. Community SheetJS
 * writes comments but not fill styles; keeping this small patch avoids another XLSX dependency. */
function highlightCells(bytes: Uint8Array, addresses: Set<string>): Uint8Array {
  const zip = XLSX.CFB.read(bytes, { type: 'array' })
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const part = (path: string) => decoder.decode(XLSX.CFB.find(zip, `/${path}`).content)
  let styles = part('xl/styles.xml')
  const fillId = Number(/<fills count="(\d+)"/.exec(styles)![1])
  const styleId = Number(/<cellXfs count="(\d+)"/.exec(styles)![1])
  styles = styles.replace(/<fills count="\d+"/, `<fills count="${fillId + 1}"`).replace('</fills>', '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill></fills>')
    .replace(/<cellXfs count="\d+"/, `<cellXfs count="${styleId + 1}"`).replace('</cellXfs>', `<xf numFmtId="0" fontId="0" fillId="${fillId}" borderId="0" xfId="0" applyFill="1"/></cellXfs>`)
  let sheet = part('xl/worksheets/sheet1.xml')
  sheet = sheet.replace(/<c\b[^>]*>/g, tag => {
    const address = /\br="([^"]+)"/.exec(tag)?.[1]
    return address && addresses.has(address) ? tag.replace(/\s+s="\d+"/g, '').replace(/\/?>(?=$)/, end => ` s="${styleId}"${end}`) : tag
  })
  XLSX.CFB.utils.cfb_add(zip, '/xl/styles.xml', encoder.encode(styles))
  XLSX.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', encoder.encode(sheet))
  return new Uint8Array(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip', compression: true }))
}

export function failedBidReport(table: BidImportTable, preview: BidImportPreview): Uint8Array {
  const wb = XLSX.utils.book_new()
  const width = preview.issues.reduce((max, issue) => Math.max(max, issue.column + 1), table.headers.length)
  const headers = Array.from({ length: width }, (_, c) => table.headers[c] || `Column ${c + 1} (missing header)`)
  const reasons = new Map<number, string[]>()
  for (const issue of preview.issues) {
    const list = reasons.get(issue.row) ?? []
    list.push(`${headers[issue.column]}: ${issue.message}`)
    reasons.set(issue.row, list)
  }
  const rows = [headers.concat('Rejection reasons'), ...table.rows.map((r, index) => [...Array.from({ length: width }, (_, c) => r[c] ?? ''), (reasons.get(index + 2) ?? []).join('\n')])]
  const ws = append(wb, 'Rejected Bids', rows)
  const addresses = new Set<string>()
  for (const issue of preview.issues) {
    const address = XLSX.utils.encode_cell({ r: issue.row - 1, c: issue.column })
    addresses.add(address)
    ws[address] ??= { t: 's', v: '' }
    ws[address].c ??= []
    ws[address].c!.push({ a: 'GOMS validation', t: issue.message })
  }
  append(wb, 'Errors', [['Excel row', 'Column', 'Possible cause / correction'], ...preview.issues.map(i => [i.row, headers[i.column], i.message])])
  append(wb, 'Instructions', [['Instructions'], ['Red cells were rejected. Hover a cell to read its cause, or use the Errors sheet. Row 1 issues concern headers or the whole file.'], ['No records from this batch were imported. Correct the source file and upload it again; this report is not an import template.']])
  return highlightCells(write(wb), addresses)
}

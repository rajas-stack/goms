import * as XLSX from 'xlsx'
import type { BidGridRow } from '@/lib/types'
import { cellValue, formatValueText, type GridColumnMeta, type EntityLookups } from '../gridColumns'
import { BID_FIELDS, BID_STAGES, bidTransferFields, resolveBidTransferField, findBidField, BID_IMPORT_MAX_COLUMNS, type BidImportTable, type BidImportPreview, type BidTransferContext } from '@goms/domain'

export const WORKBOOK_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const MAX_BID_FILE_BYTES = 5 * 1024 * 1024
/** Reads the bid sheet the way people actually keep it: the data sheet is found by its
 *  "Opportunity Name" header (other sheets are ignored), title rows above the header are skipped,
 *  formula cells contribute their calculated value, and Excel date serials become dates. */
export function parseBidWorkbook(data: ArrayBuffer): BidImportTable {
  const wb = XLSX.read(data, { type: 'array', raw: true, cellDates: false, cellFormula: true, cellNF: true, sheetRows: 1012 })
  const date1904 = !!wb.Workbook?.WBProps?.date1904
  const isNameHeader = (v: unknown) => findBidField(String(v ?? ''))?.key === 'opportunityName' || /^opportunity\s*\/?\s*(name|mission)?$/i.test(String(v ?? '').trim())
  const candidates: { name: string; headerRow: number; range: XLSX.Range }[] = []
  // The template's reference sheets also list "Opportunity Name"; they are never data.
  for (const name of wb.SheetNames.filter(n => !['Fields', 'Instructions', 'Errors', 'Warnings'].includes(n))) {
    const ws = wb.Sheets[name], ref = ws?.['!fullref'] ?? ws?.['!ref']
    if (!ref) continue
    const range = XLSX.utils.decode_range(ref)
    for (let r = range.s.r; r <= Math.min(range.s.r + 9, range.e.r); r++) {
      let hit = false
      for (let c = range.s.c; c <= range.e.c && !hit; c++) hit = isNameHeader(ws[XLSX.utils.encode_cell({ r, c })]?.v)
      if (hit) { candidates.push({ name, headerRow: r, range }); break }
    }
  }
  if (!candidates.length) {
    if (wb.SheetNames.length === 1) throw new Error('No "Opportunity Name" header was found in the first 10 rows. Add that column header above the bid rows.')
    throw new Error('No sheet has an "Opportunity Name" header in its first 10 rows. Add that header to the sheet holding the bids.')
  }
  if (candidates.length > 1) throw new Error(`Several sheets look like bid lists (${candidates.map(c => c.name).join(', ')}). Keep the bids in one sheet or upload them one file at a time.`)
  const { name, headerRow, range } = candidates[0], ws = wb.Sheets[name]
  if (range.e.r - headerRow > 1000 || range.e.c - range.s.c >= BID_IMPORT_MAX_COLUMNS) throw new Error(`The sheet is too large. Use at most 500 bids and ${BID_IMPORT_MAX_COLUMNS} columns per batch; remove distant formatted cells.`)
  const table: BidImportTable = { headers: [], rows: [], cellIssues: [] }
  for (let c = range.s.c; c <= range.e.c; c++) table.headers.push(String(ws[XLSX.utils.encode_cell({ r: headerRow, c })]?.v ?? '').replace(/\s+/g, ' ').trim())
  const kinds = table.headers.map(h => findBidField(h)?.kind)
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const row: (string | number | boolean | null)[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })], col = c - range.s.c
      // Error cells (#N/A, #REF!) carry no usable value; validation treats them as blank with a warning.
      if (cell?.t === 'e') { table.cellIssues!.push({ row: r - headerRow + 1, column: col, message: 'Spreadsheet error cell.' }); row.push(null); continue }
      let value = cell?.v ?? null
      const dateish = kinds[col] === 'date' || XLSX.SSF.is_date(cell?.z ?? '')
      if (typeof value === 'number' && dateish && value > 20000 && value < 80000) {
        const d = XLSX.SSF.parse_date_code(value, { date1904 })
        if (d && !(d.y === 1900 && d.m === 2 && d.d === 29)) value = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` + (value % 1 ? `T${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}` : '')
      }
      if (typeof value === 'number' && cell?.z?.replace(/"[^"]*"|\\./g, '').includes('%')) value = Math.round(value * 10000) / 100
      row.push(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null)
    }
    table.rows.push(row)
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
  append(wb, 'Fields', [['Field ID', 'Field', 'Visible on Live Bids', 'Type'], ...columns.map(c => [c.id, c.header, visible.has(c.id) ? 'Yes' : 'No', c.type ?? 'Read only']), ...extra.map(key => [`record:${key}`, key, 'No', 'Record metadata'])])
  append(wb, 'Instructions', [['Instructions'], ['All Live Bids rows and fields are exported, including archived rows and hidden columns. Search and saved-view filters do not limit this export.'], ['Fields lists the current column visibility as Yes or No. Use the import template for NEW bids; existing rows and generated/read-only fields are not overwritten by import.']])
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

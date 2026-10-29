import type { Workbook, Worksheet } from 'exceljs'
import { claimTotal, OWN_VEHICLE_RATE, orderedRows, rateOf, sheetDate, TWO_WHEELER_RATE, type Claim } from './model'

/** The claimant's header block on the Local Conveyance Form; remembered per user. */
export interface ClaimantDetails { employeeCode: string; employeeName: string; baseLocation: string; businessUnit: string; project?: string }

/** The month's distinct Network / WBS / Project names, in row order. */
export const claimProjects = (claim: Claim) => [...new Set(claim.expenses.map((e) => e.project).filter(Boolean))].join(', ')

const MIN_ROWS = 14
const COLS = [18, 32, 34, 13, 9, 10, 15, 24] // A Date … H Remarks

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${ordinal(d)} ${new Date(y, m - 1, d).toLocaleDateString('en-GB', { month: 'long' })} ${y}`
}

/** "9th June 2025 - 13th June 2025", from the first and last dated rows (the whole month when nothing is dated). */
export function claimPeriod(claim: Claim): string {
  const dates = claim.expenses.map((e) => e.date).filter(Boolean).sort()
  if (dates.length) return `${longDate(dates[0])} - ${longDate(dates[dates.length - 1])}`
  const [y, m] = claim.month.split('-').map(Number)
  return `${longDate(`${claim.month}-01`)} - ${longDate(`${claim.month}-${new Date(y, m, 0).getDate()}`)}`
}

const thin = { style: 'thin' as const }
const box = { top: thin, left: thin, bottom: thin, right: thin }

function put(ws: Worksheet, range: string, value: string | number | null, opts: { bold?: boolean; size?: number; align?: 'left' | 'center' | 'right'; numFmt?: string } = {}) {
  const [first] = range.split(':')
  if (range.includes(':')) ws.mergeCells(range)
  const cell = ws.getCell(first)
  cell.value = value
  cell.font = { name: 'Calibri', size: opts.size ?? 11, bold: !!opts.bold }
  cell.alignment = { vertical: 'middle', horizontal: opts.align ?? 'left', wrapText: true }
  if (opts.numFmt) cell.numFmt = opts.numFmt
}

/** The company's Local Conveyance Form for one month, filled from the claim. `logoPng` is base64 PNG (no data: prefix). */
export async function buildConveyanceWorkbook(claim: Claim, who: ClaimantDetails, logoPng: string | null): Promise<Workbook> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const ws = wb.addWorksheet('Local Conveyance', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  ws.columns = COLS.map((width) => ({ width }))
  ws.getRow(1).height = 8
  ws.getRow(2).height = 22; ws.getRow(3).height = 22

  put(ws, 'A2:C3', null)
  if (logoPng) ws.addImage(wb.addImage({ base64: logoPng, extension: 'png' }), { tl: { col: 0.15, row: 1.25 }, ext: { width: 300, height: 32 }, editAs: 'oneCell' })
  put(ws, 'D2:H3', 'Local Conveyance Form', { bold: true, size: 18, align: 'center' })
  const projects = who.project?.trim() || claimProjects(claim)
  put(ws, 'A4:B4', 'Employee code:', { bold: true }); put(ws, 'C4', who.employeeCode, { bold: true }); put(ws, 'D4:H4', `Base Location: ${who.baseLocation}`, { bold: true })
  put(ws, 'A5:B5', 'Employee Name:', { bold: true }); put(ws, 'C5', who.employeeName, { bold: true }); put(ws, 'D5:H5', `Network / WBS / Project: ${projects}`, { bold: true })
  put(ws, 'A6:B6', 'Claim Period :', { bold: true }); put(ws, 'C6', claimPeriod(claim)); put(ws, 'D6:H6', `BU - ${who.businessUnit}`, { bold: true })
  put(ws, 'A7:H7', `Note: Applicable Reimbursement for Two Wheeler is ${TWO_WHEELER_RATE.toFixed(1)} Rs/KM || Applicable Reimbursement for Four Wheeler is ${OWN_VEHICLE_RATE.toFixed(1)} Rs./KM`, { bold: true, align: 'center' })
  ;['Date', 'Network / WBS / Project Name', 'Particulars', 'Mode', 'Kms.', 'Rate', 'Amount in Rs.', 'Remarks']
    .forEach((h, i) => put(ws, `${String.fromCharCode(65 + i)}8`, h, { bold: true, align: 'center' }))

  const rows = orderedRows(claim)
  const lines = Math.max(MIN_ROWS, rows.length)
  for (let i = 0; i < lines; i++) {
    const r = 9 + i, e = rows[i]?.expense
    if (!e) continue
    const rate = rateOf(e)
    put(ws, `A${r}`, sheetDate(e.date), { align: 'right' }); put(ws, `B${r}`, e.project); put(ws, `C${r}`, e.particulars, { align: 'center' })
    put(ws, `D${r}`, e.mode, { align: 'center' }); put(ws, `E${r}`, e.kms, { align: 'center' }); put(ws, `F${r}`, rate, { align: 'center', numFmt: '0.00' })
    put(ws, `G${r}`, e.amount, { align: 'right', numFmt: '"₹" #,##0.00' }); put(ws, `H${r}`, e.remarks)
  }
  const total = 9 + lines
  put(ws, `C${total}`, 'Total', { bold: true, align: 'center' }); put(ws, `G${total}`, claimTotal(claim), { bold: true, align: 'right', numFmt: '#,##0.00' })
  put(ws, `A${total + 2}`, 'Signature', { bold: true })
  put(ws, `A${total + 4}`, 'Submitter', { bold: true }); put(ws, `C${total + 4}`, 'Team Leader', { bold: true }); put(ws, `D${total + 4}:G${total + 4}`, 'Verified by Admin/ Finance Department', { bold: true })

  for (let r = 2; r <= total + 4; r++) for (let c = 1; c <= 8; c++) ws.getCell(r, c).border = box
  return wb
}

/** A bundled PNG (the Amnex wordmark) as base64 for the workbook; null if it cannot be read. */
export async function pngBase64(url: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  } catch { return null }
}

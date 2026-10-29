import * as XLSX from 'xlsx'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { DmsConnection } from '@/features/dms/connections'
import { billState, monthLabel, orderedRows, rateOf, sheetDate, type Claim } from './model'
import { attachmentBlob } from './drive'

/** The company's claim-sheet columns, in order. */
export const SHEET_COLUMNS = ['Trip No.', 'Record no', 'Date', 'Network / WBS / Project Name', 'Particulars', 'Mode', 'Kms.', 'Rate', 'Amount in Rs.', 'Remarks', 'Bills'] as const

export function claimSheetRows(claim: Claim): (string | number)[][] {
  return orderedRows(claim).map(({ expense: e, record }) => {
    const rate = rateOf(e)
    return [e.trip, record, sheetDate(e.date), e.project, e.particulars, e.mode, e.kms ?? 'NA', rate ?? '-', e.amount, e.remarks, billState(e)]
  })
}

function sheetFor(claim: Claim): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([[...SHEET_COLUMNS], ...claimSheetRows(claim)])
  sheet['!cols'] = [6, 7, 11, 36, 34, 10, 7, 8, 13, 36, 6].map((wch) => ({ wch }))
  for (let r = 1; r <= claim.expenses.length; r++) {
    for (const c of [7, 8]) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      if (cell?.t === 'n') cell.z = '#,##0.00'
    }
  }
  return sheet
}

/** One sheet per claim, named after its month. */
export function exportClaimsXlsx(claims: Claim[], fileName: string): void {
  const book = XLSX.utils.book_new()
  for (const claim of claims) XLSX.utils.book_append_sheet(book, sheetFor(claim), monthLabel(claim.month, 'short').slice(0, 31))
  XLSX.writeFile(book, fileName)
}

const A4: [number, number] = [595.28, 841.89]

/** Formats pdf-lib cannot embed directly (webp, gif, bmp, avif, …) are redrawn as PNG by the browser. */
async function pngBytes(blob: Blob): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png) throw new Error('could not convert the image')
  return png.arrayBuffer()
}

/** Every bill of the claim, in row order (and attachment order within a row), as one PDF. Each page is stamped with
 *  its attachment code. Returns the codes that could not be included. */
export async function mergeClaimPdf(claim: Claim, drive: DmsConnection | null): Promise<{ pdf: Uint8Array; skipped: string[] }> {
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica)
  const skipped: string[] = []
  const stamp = (page: ReturnType<typeof out.addPage>, code: string) =>
    page.drawText(code, { x: 18, y: 10, size: 8, font, color: rgb(0.35, 0.35, 0.4) })

  for (const { expense } of orderedRows(claim)) {
    for (const attachment of expense.attachments) {
      try {
        const blob = await attachmentBlob(attachment, drive)
        if (attachment.mimeType === 'application/pdf') {
          const source = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true })
          for (const page of await out.copyPages(source, source.getPageIndices())) stamp(out.addPage(page), attachment.code)
          continue
        }
        const image = attachment.mimeType === 'image/jpeg' ? await out.embedJpg(await blob.arrayBuffer())
          : attachment.mimeType === 'image/png' ? await out.embedPng(await blob.arrayBuffer())
          : await out.embedPng(await pngBytes(blob))
        const page = out.addPage(A4)
        const scale = Math.min((A4[0] - 48) / image.width, (A4[1] - 60) / image.height, 1)
        const w = image.width * scale, h = image.height * scale
        page.drawImage(image, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2 + 6, width: w, height: h })
        stamp(page, attachment.code)
      } catch {
        skipped.push(attachment.code)
      }
    }
  }
  return { pdf: await out.save(), skipped }
}

export function downloadBytes(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

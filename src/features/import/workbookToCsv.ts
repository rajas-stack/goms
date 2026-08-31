import * as XLSX from 'xlsx'
import { toCsv } from '@/lib/csv'

/** Reads an uploaded Excel workbook's first sheet into the same
 *  header-row-included CSV text `ImportDialog`'s `raw` already holds for a
 *  `.csv` upload — every downstream consumer (`parseRows`, the draft,
 *  `splitCsvLine`'s comma/quote handling) stays untouched. Column order, not
 *  header names, is what `parseRows` reads (see the dialog's "File format
 *  notes"), so cells are read positionally (`header: 1`) rather than by
 *  column title. Pure logic, deliberately kept out of `ImportDialog.tsx` so
 *  it runs under this repo's fast no-DOM test suite. */
export function workbookToCsv(data: ArrayBuffer): string {
  const workbook = XLSX.read(data, { type: 'array' })
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!worksheet) return ''
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: false, raw: false, defval: '' })
  return toCsv(rows.map((row) => row.map((cell) => String(cell ?? ''))))
}

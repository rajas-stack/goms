import { downloadFile } from './file-export'

/** Quotes a single CSV field only when it needs it (contains a quote, comma,
 *  or newline), doubling any embedded quotes — the escaping half of the
 *  `splitCsvLine` reader in the import dialog. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

/** Saves `csv` as `fileName`. The BOM is what makes Excel open a UTF-8 CSV
 *  with non-ASCII names (Devanagari, ₹) correctly instead of mojibake. See
 *  `downloadFile` (file-export.ts) for the platform-specific save mechanism. */
export async function downloadCsv(fileName: string, csv: string): Promise<void> {
  await downloadFile(fileName, `﻿${csv}`, 'text/csv;charset=utf-8;')
}

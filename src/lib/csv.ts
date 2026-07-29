/** Quotes a single CSV field only when it needs it (contains a quote, comma,
 *  or newline), doubling any embedded quotes — the escaping half of the
 *  `splitCsvLine` reader in the import dialog. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

/** Triggers a browser download of `csv` as `fileName`. The BOM is what makes
 *  Excel open a UTF-8 CSV with non-ASCII names (Devanagari, ₹) correctly
 *  instead of mojibake. */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

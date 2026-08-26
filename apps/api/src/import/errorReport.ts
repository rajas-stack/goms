import type { ImportRowResult } from './types.js'

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The Errors column is always quoted, unconditionally — it's a semicolon-
 *  joined aggregate of arbitrary validation-error text (any one of which
 *  could itself contain a comma), so treating it the same as a plain single
 *  value (quote only if this exact joined string needs it) would produce a
 *  CSV that's usually fine but silently wrong the moment one message does
 *  contain a comma. Business Key stays conditionally quoted since it's a
 *  single, narrower value. */
function csvErrorsField(errors: string[]): string {
  return `"${errors.join('; ').replace(/"/g, '""')}"`
}

export function buildErrorReportCsv(rows: ImportRowResult[]): string {
  const lines = ['Row,Business Key,Errors']
  for (const row of rows) {
    if (row.action !== 'reject') continue
    lines.push([String(row.rowNumber), csvField(row.businessKey), csvErrorsField(row.errors)].join(','))
  }
  return lines.join('\n') + '\n'
}

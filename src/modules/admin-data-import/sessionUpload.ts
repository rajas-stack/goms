import * as XLSX from 'xlsx'
import { sheetHeaders, rowsFromSheet, MULTI_SHEET_KEYS } from './templates'
import { detectDomainForSheet, type DetectionResult } from './domainDetection'
import type { ExcludedRow, ImportAction, ImportRow, ImportRows, SpreadsheetDomainKey } from './api'

export interface DetectedSheet {
  /** Stable across one upload session — `${fileName}::${sheetTitle}::${index}` */
  id: string
  fileName: string
  sheetTitle: string
  headers: string[]
  rows: ImportRow[]
  detection: DetectionResult
}

/** One workbook may hold several sheets; each is independently detected —
 *  domain/order don't matter across files (design spec §5: "Order and
 *  grouping across files don't matter — only sheet content does"). Blank
 *  trailing rows are dropped per-sheet, matching parseWorkbook's existing
 *  convention. */
export function extractSheetsFromFile(fileName: string, data: ArrayBuffer): DetectedSheet[] {
  const workbook = XLSX.read(data, { type: 'array' })
  const isBlank = (row: ImportRow) => Object.values(row).every((v) => v === '' || v === undefined)

  return workbook.SheetNames.map((sheetTitle, index) => {
    const worksheet = workbook.Sheets[sheetTitle]
    const headers = sheetHeaders(worksheet)
    const rows = rowsFromSheet(worksheet).filter((r) => !isBlank(r))
    return { id: `${fileName}::${sheetTitle}::${index}`, fileName, sheetTitle, headers, rows, detection: detectDomainForSheet(sheetTitle, headers) }
  }).filter((s) => s.rows.length > 0 || s.headers.length > 0)
}

/** Groups every assigned sheet's already-field-mapped rows into the
 *  `{domain: rows}` payload apps/api's session.validate/session.commit
 *  expect. A sheet with no entry in `assignments` (still pending
 *  confirmation, or the user explicitly excluded it from this session) is
 *  silently omitted here — never defaulted to some guessed domain. */
export function buildSessionDomains(
  sheets: DetectedSheet[],
  assignments: Map<string, { domain: SpreadsheetDomainKey; sheetTitle: string }>,
): Partial<Record<SpreadsheetDomainKey, ImportRows>> {
  const result: Partial<Record<SpreadsheetDomainKey, ImportRows>> = {}

  for (const sheet of sheets) {
    const assignment = assignments.get(sheet.id)
    if (!assignment) continue
    const { domain, sheetTitle } = assignment
    const sheetKeys = MULTI_SHEET_KEYS[domain]

    if (!sheetKeys) {
      const existing = (result[domain] as ImportRow[] | undefined) ?? []
      result[domain] = [...existing, ...sheet.rows]
      continue
    }

    const internalKey = sheetKeys[sheetTitle]
    if (!internalKey) continue
    const existingDict = (result[domain] as Record<string, ImportRow[]> | undefined) ?? {}
    result[domain] = { ...existingDict, [internalKey]: [...(existingDict[internalKey] ?? []), ...sheet.rows] }
  }

  return result
}

/** True once every `needs-review`/`reject` row in `previewRows` has a
 *  matching entry in `excludedRows` (by domain + sheetKey + rowNumber) —
 *  the frontend's own gate for enabling the Commit button, computed purely
 *  from local state. Deliberately does NOT re-validate or trim anything;
 *  `session.commit` (Task 7/9) does its own, authoritative version of this
 *  same check server-side against live data — this is only for a
 *  responsive UI, never trusted as the real gate. */
export function unresolvedRowsAreAllExcluded(
  previewRows: { domain: SpreadsheetDomainKey; sheetKey?: string; rowNumber: number; action: ImportAction }[],
  excludedRows: ExcludedRow[],
): boolean {
  const unresolved = previewRows.filter((r) => r.action === 'needs-review' || r.action === 'reject')
  return unresolved.every((r) =>
    excludedRows.some((e) => e.domain === r.domain && e.sheetKey === r.sheetKey && e.rowNumber === r.rowNumber),
  )
}

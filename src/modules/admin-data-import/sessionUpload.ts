import * as XLSX from 'xlsx'
import { sheetHeaders, rowsFromSheet, resolveHeaderField, MULTI_SHEET_KEYS } from './templates'
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

/** A sheet carrying a "Level" column (or an alias resolving to it) alongside
 *  the shared catalog Code/Name columns is a combined, single-sheet export
 *  of commercialMastersCatalog's four normally-separate sheets (Verticals/
 *  Products/Modules/Features), discriminated by that column rather than by
 *  which tab the rows are on — a realistic way for a business export to
 *  organize this data, and one the app should decompose automatically
 *  rather than force the admin to manually split into four sheets first. */
function isCombinedCatalogSheet(headers: string[]): boolean {
  const fields = new Set(headers.map((h) => resolveHeaderField(undefined, h)).filter(Boolean))
  return fields.has('catalogLevel') && fields.has('code') && fields.has('name')
}

const CATALOG_LEVEL_TO_KIND: Record<string, 'verticals' | 'products' | 'modules' | 'features'> = {
  vertical: 'verticals', product: 'products', module: 'modules', feature: 'features',
}
const CATALOG_KIND_TO_SHEET_TITLE: Record<'verticals' | 'products' | 'modules' | 'features', string> = {
  verticals: 'Verticals', products: 'Products', modules: 'Modules', features: 'Features',
}

/** Splits one combined catalog sheet's already-field-mapped rows into the
 *  four real commercialMastersCatalog sheets, by each row's own Level value
 *  — matched case-insensitively (ordinary formatting variance, same as every
 *  other enum-like value in this app). Each resulting virtual sheet is
 *  pre-matched to its real sheetTitle ('Verticals'/'Products'/'Modules'/
 *  'Features'), so buildSessionDomains' existing MULTI_SHEET_KEYS lookup
 *  routes it correctly with no further changes — all four then validate and
 *  commit together in the SAME session, in the SAME dependency order
 *  (Vertical -> Product -> Module -> Feature) commercialMastersCatalog's own
 *  backend adapter already enforces for any multi-sheet upload.
 *
 *  A row whose Level doesn't match one of the four (typo, blank, a
 *  genuinely different value) is never silently dropped or guessed into the
 *  wrong bucket — it's collected into its own clearly-labeled virtual sheet
 *  (kind 'unrecognized', same as any other sheet needing the admin's own
 *  choice), naming exactly which bad value(s) were found so the problem is
 *  visible without having to open the workbook again. */
function splitCombinedCatalogSheet(fileName: string, sheetTitle: string, index: number, rows: ImportRow[]): DetectedSheet[] {
  const buckets: Record<'verticals' | 'products' | 'modules' | 'features', ImportRow[]> = {
    verticals: [], products: [], modules: [], features: [],
  }
  const invalid: { row: ImportRow; rawLevel: unknown }[] = []

  for (const row of rows) {
    const { catalogLevel, ...rest } = row
    const normalized = typeof catalogLevel === 'string' ? catalogLevel.trim().toLowerCase() : ''
    const kind = CATALOG_LEVEL_TO_KIND[normalized]
    if (kind) buckets[kind].push(rest)
    else invalid.push({ row, rawLevel: catalogLevel })
  }

  const sheets: DetectedSheet[] = (Object.keys(buckets) as (keyof typeof buckets)[])
    .filter((kind) => buckets[kind].length > 0)
    .map((kind) => ({
      id: `${fileName}::${sheetTitle}::${index}::${kind}`,
      fileName,
      sheetTitle: CATALOG_KIND_TO_SHEET_TITLE[kind],
      headers: [],
      rows: buckets[kind],
      detection: { kind: 'matched', domain: 'commercialMastersCatalog', sheetTitle: CATALOG_KIND_TO_SHEET_TITLE[kind] } as DetectionResult,
    }))

  if (invalid.length > 0) {
    const badValues = [...new Set(invalid.map((r) => (r.rawLevel === '' || r.rawLevel == null ? '(blank)' : String(r.rawLevel))))]
    sheets.push({
      id: `${fileName}::${sheetTitle}::${index}::invalid-level`,
      fileName,
      sheetTitle: `${sheetTitle} — invalid Level value(s) [${badValues.join(', ')}], must be Vertical/Product/Module/Feature`,
      headers: [],
      rows: invalid.map((r) => r.row),
      detection: { kind: 'unrecognized' },
    })
  }

  return sheets
}

/** One workbook may hold several sheets; each is independently detected —
 *  domain/order don't matter across files (design spec §5: "Order and
 *  grouping across files don't matter — only sheet content does"). Blank
 *  trailing rows are dropped per-sheet, matching parseWorkbook's existing
 *  convention. */
export function extractSheetsFromFile(fileName: string, data: ArrayBuffer): DetectedSheet[] {
  const workbook = XLSX.read(data, { type: 'array' })
  const isBlank = (row: ImportRow) => Object.values(row).every((v) => v === '' || v === undefined)

  return workbook.SheetNames.flatMap((sheetTitle, index): DetectedSheet[] => {
    const worksheet = workbook.Sheets[sheetTitle]
    const headers = sheetHeaders(worksheet)

    if (isCombinedCatalogSheet(headers)) {
      const rows = rowsFromSheet(worksheet, 'commercialMastersCatalog').filter((r) => !isBlank(r))
      return splitCombinedCatalogSheet(fileName, sheetTitle, index, rows)
    }

    const detection = detectDomainForSheet(sheetTitle, headers)
    // Resolving domain-scoped header overrides (e.g. "Org Code" meaning the
    // node's own code here but an employee's org reference elsewhere)
    // correctly requires knowing the domain — available now for an
    // auto-detected sheet. A still-unresolved sheet (ambiguous/unrecognized)
    // parses with only each header's global meaning until the admin picks
    // one explicitly; nothing here re-parses once they do (see
    // buildSessionDomains below), same as before this override table existed.
    const rows = rowsFromSheet(worksheet, detection.kind === 'matched' ? detection.domain : undefined).filter((r) => !isBlank(r))
    return [{ id: `${fileName}::${sheetTitle}::${index}`, fileName, sheetTitle, headers, rows, detection }]
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

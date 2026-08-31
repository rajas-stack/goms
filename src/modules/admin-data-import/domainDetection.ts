import { TEMPLATE_COLUMNS, HEADER_TO_FIELD, FIELD_TO_HEADERS } from './templates'
import type { SpreadsheetDomainKey } from './api'

interface TemplateSheetSignature {
  domain: SpreadsheetDomainKey
  sheetTitle: string
  requiredFields: string[]
  /** Every column this sheet's template defines (required + optional),
   *  translated to field names — used only to break a tie between two
   *  signatures with an identical required-field score (e.g.
   *  organizationHierarchy and commercialMastersCatalog's child sheets both
   *  require exactly 3 fields and can share all 3 header spellings for a
   *  sheet like "Node Type/Name/Code/Parent Code/State Code/Status" — the
   *  richer overlap against the FULL column set is what actually
   *  distinguishes them, without changing which sheets clear the pass/fail
   *  floor in the first place (still required-fields-only, per this task's
   *  design note on why an optional column's absence shouldn't lower a
   *  sheet's score). */
  allFields: string[]
}

// Mirrors each backend domain adapter's own non-optional zod fields (not
// every column — an optional column's absence shouldn't lower a sheet's
// detection score). See apps/api/src/import/domains/*.ts for the source of
// truth this list is drawn from.
const REQUIRED_FIELDS: Record<string, string[]> = {
  'organizationHierarchy::Organization Hierarchy': ['nodeType', 'name', 'code'],
  'employees::Employees': ['employeeCode', 'designation', 'orgNodeCode'],
  'salesRoster::Sales Persons': ['officialEmail', 'name'],
  'salesRoster::Postings': ['salesPersonEmail', 'designation', 'tierKey', 'startDate'],
  'commercialMastersCatalog::Verticals': ['code', 'name'],
  'commercialMastersCatalog::Products': ['code', 'name', 'parentCode'],
  'commercialMastersCatalog::Modules': ['code', 'name', 'parentCode'],
  'commercialMastersCatalog::Features': ['code', 'name', 'parentCode'],
  'commercialMastersFlat::SKU Categories': ['code', 'name'],
  'commercialMastersFlat::Units of Measure': ['code', 'name'],
  'commercialMastersFlat::Product Editions': ['code', 'name'],
  'commercialMastersFlat::Billing Types': ['code', 'name'],
  'commercialMastersFlat::Pre-Sales': ['code', 'name'],
  'currencies::Currencies': ['code', 'name'],
  'taxClasses::Tax Classes': ['code', 'name'],
  'approvalMatrix::Approval Matrix': ['code', 'name', 'minDiscountPct', 'maxDiscountPct'],
  'skus::SKUs': ['skuCode', 'name', 'categoryCode', 'featureCode', 'uomCode', 'currencyCode', 'taxClassCode', 'billingTypeCode', 'activeFrom'],
  'bom::BOM': ['parentSkuCode', 'componentSkuCode'],
}

const ALL_SIGNATURES: TemplateSheetSignature[] = Object.entries(TEMPLATE_COLUMNS).flatMap(([domain, sheets]) =>
  sheets.map((s) => ({
    domain: domain as SpreadsheetDomainKey,
    sheetTitle: s.sheet,
    requiredFields: REQUIRED_FIELDS[`${domain}::${s.sheet}`] ?? [],
    allFields: [...new Set(s.columns.map((h) => HEADER_TO_FIELD[h]).filter((f): f is string => Boolean(f)))],
  })),
)

const MIN_DETECTION_SCORE = 0.6

export type DetectionResult =
  | { kind: 'matched'; domain: SpreadsheetDomainKey; sheetTitle: string }
  | { kind: 'ambiguous'; candidates: { domain: SpreadsheetDomainKey; sheetTitle: string }[] }
  | { kind: 'unrecognized' }

function scoreSignature(headers: Set<string>, sig: TemplateSheetSignature): number {
  if (sig.requiredFields.length === 0) return 0
  const recognized = sig.requiredFields.filter((field) => (FIELD_TO_HEADERS[field] ?? []).some((h) => headers.has(h)))
  return recognized.length / sig.requiredFields.length
}

function fullOverlapCount(headers: Set<string>, sig: TemplateSheetSignature): number {
  return sig.allFields.filter((field) => (FIELD_TO_HEADERS[field] ?? []).some((h) => headers.has(h))).length
}

/** Auto-assigns a sheet to a domain/template-sheet. An exact (trimmed,
 *  case-insensitive) title match against a known template sheet always
 *  wins outright (see this task's design note); otherwise scores every
 *  template sheet by required-field header overlap (aliases included) and
 *  either returns the single clear winner, flags a tie as ambiguous (design
 *  spec §5's "which type of data is this sheet?" case — expected for the
 *  several near-identical flat-master sheets), or reports unrecognized. */
export function detectDomainForSheet(sheetTitle: string, headers: string[]): DetectionResult {
  const normalizedTitle = sheetTitle.trim().toLowerCase()
  const titleMatch = ALL_SIGNATURES.find((sig) => sig.sheetTitle.toLowerCase() === normalizedTitle)
  if (titleMatch) return { kind: 'matched', domain: titleMatch.domain, sheetTitle: titleMatch.sheetTitle }

  const headerSet = new Set(headers.map((h) => h.trim()))
  const scored = ALL_SIGNATURES
    .map((sig) => ({ sig, score: scoreSignature(headerSet, sig), overlap: fullOverlapCount(headerSet, sig) }))
    .filter((s) => s.score >= MIN_DETECTION_SCORE)
    .sort((a, b) => b.score - a.score || b.overlap - a.overlap)

  if (scored.length === 0) return { kind: 'unrecognized' }
  const top = scored[0]
  // A tie requires BOTH the required-field score and the full-column
  // overlap to match — the overlap dimension is what actually disambiguates
  // e.g. organizationHierarchy from commercialMastersCatalog's child sheets,
  // which can otherwise share an identical required-field score.
  const tied = scored.filter((s) => s.score === top.score && s.overlap === top.overlap)
  if (tied.length > 1) {
    return { kind: 'ambiguous', candidates: tied.map((s) => ({ domain: s.sig.domain, sheetTitle: s.sig.sheetTitle })) }
  }
  return { kind: 'matched', domain: top.sig.domain, sheetTitle: top.sig.sheetTitle }
}

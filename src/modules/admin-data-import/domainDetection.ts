import { TEMPLATE_COLUMNS, HEADER_TO_FIELD, headersForField } from './templates'
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
  const recognized = sig.requiredFields.filter((field) => headersForField(sig.domain, field).some((h) => headers.has(h)))
  return recognized.length / sig.requiredFields.length
}

function fullOverlapCount(headers: Set<string>, sig: TemplateSheetSignature): number {
  return sig.allFields.filter((field) => headersForField(sig.domain, field).some((h) => headers.has(h))).length
}

/** Auto-assigns a sheet to a domain/template-sheet, primarily from the
 *  sheet's own header content — NOT from its tab name. A real admin export
 *  routinely renames tabs to something business-friendly ("Organization
 *  Structure" instead of "Organization Hierarchy"), and a tab name match
 *  alone says nothing about whether the sheet's actual columns resolve to
 *  that domain (a sheet named exactly right but carrying only a title/note
 *  above its real header used to "match" by name and then parse to zero
 *  usable rows — see this task's write-up). Every template sheet is scored
 *  by required-field header overlap (canonical names, global aliases, and
 *  domain-scoped override spellings all count); the sheet's tab name is
 *  used only to break a genuine tie between two signatures that score
 *  identically on content — e.g. commercialMastersFlat's five near-identical
 *  flat-master sheets, which share the same two required fields and can
 *  only be told apart by which one the tab is actually named after. A tie
 *  with no single tab-name winner is reported as ambiguous, same as before. */
export function detectDomainForSheet(sheetTitle: string, headers: string[]): DetectionResult {
  const normalizedTitle = sheetTitle.trim().toLowerCase()
  const headerSet = new Set(headers.map((h) => h.trim()))

  const scored = ALL_SIGNATURES
    .map((sig) => ({
      sig,
      score: scoreSignature(headerSet, sig),
      overlap: fullOverlapCount(headerSet, sig),
      titleMatches: sig.sheetTitle.toLowerCase() === normalizedTitle,
    }))
    .filter((s) => s.score >= MIN_DETECTION_SCORE)
    .sort((a, b) => b.score - a.score || b.overlap - a.overlap)

  if (scored.length === 0) return { kind: 'unrecognized' }
  const top = scored[0]

  function resolveTie(tied: typeof scored): DetectionResult {
    // The tab name only resolves the tie when it points at exactly ONE of
    // the tied candidates — two tied candidates BOTH named the same as the
    // tab (impossible, template sheet titles are unique) or none of them
    // still leaves genuine ambiguity for the admin to resolve by hand.
    const titleWinners = tied.filter((s) => s.titleMatches)
    if (titleWinners.length === 1) {
      return { kind: 'matched', domain: titleWinners[0].sig.domain, sheetTitle: titleWinners[0].sig.sheetTitle }
    }
    return { kind: 'ambiguous', candidates: tied.map((s) => ({ domain: s.sig.domain, sheetTitle: s.sig.sheetTitle })) }
  }

  // Two different kinds of tie need different tie-breakers:
  //  - Siblings of the SAME multi-sheet domain tied on required-field score
  //    (e.g. commercialMastersCatalog's Verticals/Products/Modules/Features,
  //    or commercialMastersFlat's five near-identical flat sheets): an
  //    optional-column overlap difference between them is NOT trustworthy.
  //    A single sheet that flattens every sibling's rows together (a "Level"
  //    column mixing verticals/products/modules/features, say) naturally
  //    carries the UNION of every sibling's optional columns, which biases
  //    overlap toward whichever sibling happens to declare the most columns
  //    — Features, purely because it alone has a Feature Status column —
  //    even though the sheet is not actually that one sibling's data. Only
  //    an exact tab-title match may resolve this; anything else must stay
  //    genuinely ambiguous rather than confidently guess wrong.
  const siblingsTied = scored.filter((s) => s.sig.domain === top.sig.domain && s.score === top.score)
  if (siblingsTied.length > 1) return resolveTie(siblingsTied)

  //  - Candidates from DIFFERENT domains tied on required-field score: the
  //    full-column overlap IS a legitimate disambiguator here (e.g.
  //    organizationHierarchy vs. commercialMastersCatalog's child sheets,
  //    which can otherwise share an identical required-field score).
  const tied = scored.filter((s) => s.score === top.score && s.overlap === top.overlap)
  if (tied.length > 1) return resolveTie(tied)

  return { kind: 'matched', domain: top.sig.domain, sheetTitle: top.sig.sheetTitle }
}

/** Human-readable Opportunity ID ("opportunity code"):
 *
 *    [FY]-[Quarter]-[Vertical]-[Zone]-[State]-[Client]-[Type]-[Scope]-[Sequence]
 *    e.g. FY27-Q2-DF-WEST-GJ-DST-RFP-DL-1
 *
 *  Pure functions only — the frontend (live preview, in-memory store) and the
 *  API (insert path, backfill script) build the SAME prefix from the same
 *  inputs. The sequence is one counter per fiscal year, allocated by each
 *  data layer; the code is generated once at creation and never changes. */

// --- shared helpers -----------------------------------------------------------

/** A blank / missing segment. Never empty, so a code never has `--`. */
export const OPPORTUNITY_CODE_BLANK = 'NA'
/** Stands in for the sequence in a live preview ("number assigned on save"). */
export const OPPORTUNITY_CODE_PLACEHOLDER = '#'

const CODE_STOPWORDS = new Set(['and', 'of', 'the', 'for', 'in', 'to', 'a', 'an'])

/** Uppercase A–Z0–9 only, cut to `max`; '' stays ''. */
function normalizeSegment(raw: string, max: number): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max)
}

/** Lookup key for free text: lowercase, `&` → `and`, punctuation/brackets → spaces. */
function lookupKey(raw: string): string {
  return raw.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The standard short code for text with no mapping: initials of the significant
 *  words (dropping &, and, of, the, brackets…), or — for one word — the word
 *  itself when it is already short (ITMS, ICCC, DL), else its first 3 letters. */
export function abbreviateCode(text: string, max = 5): string {
  const words = text.replace(/&/g, ' ').split(/[^A-Za-z0-9]+/).filter((w) => w && !CODE_STOPWORDS.has(w.toLowerCase()))
  if (!words.length) return ''
  if (words.length === 1) {
    const word = words[0]
    return normalizeSegment(word.length <= max ? word : word.slice(0, 3), max)
  }
  return normalizeSegment(words.map((w) => w[0]).join(''), max)
}

// --- fiscal period ------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export interface CalendarDate { year: number; month: number; day: number }

function validDate(year: number, month: number, day: number): CalendarDate | null {
  if (!(year >= 1900 && year <= 2999) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null
  return { year, month, day }
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y)
const IST_OFFSET_MS = 330 * 60_000

/** Parses the messy free-text dates opportunities carry — ISO ("2026-10-10",
 *  "2026-10-10T08:30:00Z", read in IST), Indian day-first ("10-10-2026 14:00 Hrs",
 *  "10/10/2026", "10.10.26"), and month names ("10 Oct 2026", "Oct 10, 2026").
 *  Day-first wins for an ambiguous numeric date (Indian convention); a
 *  month > 12 in that position is read as month-first instead. Calendar
 *  fields are read straight from the text — no timezone shift. null when
 *  nothing parses. */
export function parseLooseDate(raw: string | null | undefined): CalendarDate | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  // A full timestamp with a zone ("2026-03-31T18:30:00.000Z", what the Create Bid
  // deadline picker stores) is an instant: read its date in India time, the
  // business's own timezone, so 1 Apr 00:00 IST is never filed under March.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const instant = new Date(text)
    if (!Number.isNaN(instant.getTime())) {
      const ist = new Date(instant.getTime() + IST_OFFSET_MS)
      return validDate(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate())
    }
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text)
  if (m) return validDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?!\d)/.exec(text)
  if (m) {
    const [a, b, y] = [+m[1], +m[2], fullYear(+m[3])]
    return b > 12 && a <= 12 ? validDate(y, a, b) : validDate(y, b, a)
  }
  m = /(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2,4})(?!\d)/.exec(text)
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) {
    return validDate(fullYear(+m[3]), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1])
  }
  m = /([A-Za-z]{3,9})[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/.]+(\d{4})/.exec(text)
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) {
    return validDate(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2])
  }
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : validDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
}

export interface FiscalPeriod {
  /** 'FY27' — 'FY' + the 2-digit year the Indian fiscal year (Apr–Mar) ENDS in. */
  fiscalYear: string
  /** 'Q1' (Apr–Jun) … 'Q4' (Jan–Mar). */
  quarter: string
}

/** Indian fiscal year + quarter of a date: FY27 = 1 Apr 2026 – 31 Mar 2027. A
 *  `Date` is read in local time; a string goes through `parseLooseDate`. */
export function fiscalPeriod(date: Date | CalendarDate): FiscalPeriod {
  const { year, month } = date instanceof Date ? { year: date.getFullYear(), month: date.getMonth() + 1 } : date
  const endYear = month >= 4 ? year + 1 : year
  const quarter = month >= 4 ? Math.floor((month - 4) / 3) + 1 : 4
  return { fiscalYear: `FY${String(endYear % 100).padStart(2, '0')}`, quarter: `Q${quarter}` }
}

/** The date an opportunity's FY/quarter come from: its submission date, else
 *  when it was created, else today. */
export function opportunityCodeDate(submissionDate?: string | null, createdAt?: string | null, today: Date = new Date()): CalendarDate {
  return parseLooseDate(submissionDate) ?? parseLooseDate(createdAt)
    ?? { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() }
}

// --- vertical -----------------------------------------------------------------

/** Canonical verticals (WORK_VERTICALS) and the variants people type for them. */
const VERTICAL_CODES: Record<string, string> = {
  'traffic': 'TRF',
  'transit mobility': 'MOB', 'transit': 'MOB', 'mobility': 'MOB',
  'data fabric and ai': 'DF', 'data fabric': 'DF',
  'integrated smart city': 'ISC', 'smart city': 'ISC', 'integrated': 'ISC',
  'gis': 'GIS',
  'agriculture': 'AGR',
  'resource and utility': 'RU', 'resources and utilities': 'RU', 'resource and utilities': 'RU',
  'cloud': 'CLD',
}

export function verticalCode(vertical: string | null | undefined): string {
  const text = (vertical ?? '').trim()
  if (!text) return OPPORTUNITY_CODE_BLANK
  return VERTICAL_CODES[lookupKey(text)] ?? (abbreviateCode(text, 5) || OPPORTUNITY_CODE_BLANK)
}

// --- state + zone -------------------------------------------------------------

export type OpportunityZone = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'CENTRAL' | 'NE'

/** Keyed by LGD/census state code (src/data/india-admin.json's `st_code`).
 *  Vehicle-registration-style codes; 28 (pre-2014 Andhra Pradesh) and 25
 *  (pre-2020 Daman & Diu) are kept so legacy codes still resolve. */
export const STATE_CODE_TABLE: Record<number, { state: string; zone: OpportunityZone; name: string }> = {
  1: { state: 'JK', zone: 'NORTH', name: 'Jammu and Kashmir' },
  2: { state: 'HP', zone: 'NORTH', name: 'Himachal Pradesh' },
  3: { state: 'PB', zone: 'NORTH', name: 'Punjab' },
  4: { state: 'CH', zone: 'NORTH', name: 'Chandigarh' },
  5: { state: 'UK', zone: 'NORTH', name: 'Uttarakhand' },
  6: { state: 'HR', zone: 'NORTH', name: 'Haryana' },
  7: { state: 'DL', zone: 'NORTH', name: 'Delhi' },
  8: { state: 'RJ', zone: 'NORTH', name: 'Rajasthan' },
  9: { state: 'UP', zone: 'NORTH', name: 'Uttar Pradesh' },
  10: { state: 'BR', zone: 'EAST', name: 'Bihar' },
  11: { state: 'SK', zone: 'NE', name: 'Sikkim' },
  12: { state: 'AR', zone: 'NE', name: 'Arunachal Pradesh' },
  13: { state: 'NL', zone: 'NE', name: 'Nagaland' },
  14: { state: 'MN', zone: 'NE', name: 'Manipur' },
  15: { state: 'MZ', zone: 'NE', name: 'Mizoram' },
  16: { state: 'TR', zone: 'NE', name: 'Tripura' },
  17: { state: 'ML', zone: 'NE', name: 'Meghalaya' },
  18: { state: 'AS', zone: 'NE', name: 'Assam' },
  19: { state: 'WB', zone: 'EAST', name: 'West Bengal' },
  20: { state: 'JH', zone: 'EAST', name: 'Jharkhand' },
  21: { state: 'OD', zone: 'EAST', name: 'Odisha' },
  22: { state: 'CG', zone: 'CENTRAL', name: 'Chhattisgarh' },
  23: { state: 'MP', zone: 'CENTRAL', name: 'Madhya Pradesh' },
  24: { state: 'GJ', zone: 'WEST', name: 'Gujarat' },
  25: { state: 'DD', zone: 'WEST', name: 'Daman and Diu' },
  26: { state: 'DD', zone: 'WEST', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  27: { state: 'MH', zone: 'WEST', name: 'Maharashtra' },
  28: { state: 'AP', zone: 'SOUTH', name: 'Andhra Pradesh' },
  29: { state: 'KA', zone: 'SOUTH', name: 'Karnataka' },
  30: { state: 'GA', zone: 'WEST', name: 'Goa' },
  31: { state: 'LD', zone: 'SOUTH', name: 'Lakshadweep' },
  32: { state: 'KL', zone: 'SOUTH', name: 'Kerala' },
  33: { state: 'TN', zone: 'SOUTH', name: 'Tamil Nadu' },
  34: { state: 'PY', zone: 'SOUTH', name: 'Puducherry' },
  35: { state: 'AN', zone: 'EAST', name: 'Andaman and Nicobar Islands' },
  36: { state: 'TG', zone: 'SOUTH', name: 'Telangana' },
  37: { state: 'AP', zone: 'SOUTH', name: 'Andhra Pradesh' },
  38: { state: 'LA', zone: 'NORTH', name: 'Ladakh' },
}

/** `stateCode` 0 = Central Ministries (gov-hierarchy's CENTRAL_STATE_CODE). */
export function stateCodeInfo(stateCode: number | string | null | undefined): { state: string; zone: string } {
  if (stateCode === null || stateCode === undefined || stateCode === '') return { state: OPPORTUNITY_CODE_BLANK, zone: OPPORTUNITY_CODE_BLANK }
  const code = Number(stateCode)
  if (code === 0) return { state: 'CEN', zone: 'CENTRAL' }
  const row = STATE_CODE_TABLE[code]
  return row ? { state: row.state, zone: row.zone } : { state: OPPORTUNITY_CODE_BLANK, zone: OPPORTUNITY_CODE_BLANK }
}

// --- client / department ------------------------------------------------------

const ABBREVIATION_STOPWORDS = new Set(['of', 'and', 'the', 'for', 'in', 'to', '&'])

/** Auto-derived department abbreviation in the style of real ministry
 *  short names (MoSPI, DoT, …) — every word contributes its first letter,
 *  capitalized for a significant word and lowercase for a minor connector
 *  (of/and/the/for/in/to/&), e.g. "Department of National Agencies" →
 *  "DoNA". Used wherever a department's short name is shown and none has
 *  been entered by hand, so departments never need one typed in just to
 *  get a usable abbreviation. */
export function abbreviateDepartmentName(name: string): string {
  return name
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => (ABBREVIATION_STOPWORDS.has(w.toLowerCase()) ? w[0].toLowerCase() : w[0].toUpperCase()))
    .filter((c) => /[A-Za-z]/.test(c))
    .join('')
}

/** The department's hand-entered short name, else its auto abbreviation —
 *  uppercase A–Z0–9, at most 8 characters. */
export function clientCode(dept: { shortName?: string | null; name?: string | null } | null | undefined): string {
  const source = dept?.shortName?.trim() || (dept?.name?.trim() ? abbreviateDepartmentName(dept.name.trim()) : '')
  return normalizeSegment(source, 8) || OPPORTUNITY_CODE_BLANK
}

// --- opportunity type ---------------------------------------------------------

/** Options for `Opportunity.opportunityType` ('' = not set). */
export const OPPORTUNITY_TYPES = ['RFP', 'RFQ', 'EOI', 'RFI', 'GeM', 'Tender', 'Direct'] as const

const TYPE_CODES: Record<string, string> = {
  rfp: 'RFP', rfq: 'RFQ', eoi: 'EOI', rfi: 'RFI', gem: 'GEM', tender: 'TND', direct: 'DIR',
}

export function opportunityTypeCode(type: string | null | undefined): string {
  const text = (type ?? '').trim()
  if (!text) return OPPORTUNITY_CODE_BLANK
  return TYPE_CODES[lookupKey(text)] ?? (abbreviateCode(text, 5) || OPPORTUNITY_CODE_BLANK)
}

// --- scope / solution ---------------------------------------------------------

/** AMNEX's own products (amnex.com/products), in the order the component
 *  picker lists them — the first of these picked names the scope. */
export const AMNEX_PRODUCTS = [
  'Golden Record', 'IPMP', 'Locomate',
  'Syncnex', 'Rapidgo', 'XUP', 'Elbtros',
  'Outline', 'Spectator', 'IIon', 'Ecokeeper', 'Spotlock',
  'Agrogate', 'Agrogate Finance', 'Croptrack', 'Farmlive', 'Recloud',
  'Nirikshak', 'Eargo', 'Veintex', 'Trackous', 'Portvein', 'Samarth', 'Dairynex',
  'BlocSafe',
]

/** Known components/products. Anything else falls back to `abbreviateCode`,
 *  which keeps already-short tags (IPMP, ITMS, ICCC, DL) as they are. */
const SCOPE_CODES: Record<string, string> = {
  'golden record': 'GR', 'ipmp': 'IPMP', 'locomate': 'LCM', 'syncnex': 'SNX', 'rapidgo': 'RPG', 'xup': 'XUP',
  'elbtros': 'ELB', 'outline': 'OTL', 'spectator': 'SPEC', 'iion': 'IION', 'ecokeeper': 'ECK', 'spotlock': 'SPL',
  'agrogate': 'AGG', 'agrogate finance': 'AGF', 'croptrack': 'CRT', 'farmlive': 'FML', 'recloud': 'RCL',
  'nirikshak': 'NRK', 'eargo': 'EGO', 'veintex': 'VTX', 'trackous': 'TRK', 'portvein': 'PTV', 'samarth': 'SMT',
  'dairynex': 'DNX', 'blocsafe': 'BLS', 'other': 'OTH',
  'hardware': 'HW', 'software': 'SW', 'services': 'SVC', 'system integration': 'SI', 'amc': 'AMC',
  'supply': 'SUP', 'installation': 'INST', 'consulting': 'CONS', 'license': 'LIC', 'support': 'SUPP',
}

/** Scope from the picked components: the first AMNEX product (in product-list
 *  order), else the first component. */
export function scopeCode(components: readonly string[] | null | undefined): string {
  const picked = (components ?? []).map((c) => c.trim()).filter(Boolean)
  if (!picked.length) return OPPORTUNITY_CODE_BLANK
  const pickedKeys = new Set(picked.map(lookupKey))
  const product = AMNEX_PRODUCTS.find((p) => pickedKeys.has(lookupKey(p)))
  const chosen = product ?? picked[0]
  return SCOPE_CODES[lookupKey(chosen)] ?? (abbreviateCode(chosen, 6) || OPPORTUNITY_CODE_BLANK)
}

// --- the code -----------------------------------------------------------------

export interface OpportunityCodeInput {
  submissionDate?: string | null
  createdAt?: string | null
  vertical?: string | null
  stateCode?: number | null
  /** The opportunity's department: `metadata.shortName` and `name`. */
  department?: { shortName?: string | null; name?: string | null } | null
  opportunityType?: string | null
  component?: readonly string[] | null
}

/** Everything but the sequence, plus the fiscal year that keys the sequence. */
export function opportunityCodeParts(input: OpportunityCodeInput, today: Date = new Date()): { fiscalYear: string; prefix: string } {
  const { fiscalYear, quarter } = fiscalPeriod(opportunityCodeDate(input.submissionDate, input.createdAt, today))
  const { state, zone } = stateCodeInfo(input.stateCode)
  const segments = [
    fiscalYear, quarter, verticalCode(input.vertical), zone, state,
    clientCode(input.department), opportunityTypeCode(input.opportunityType), scopeCode(input.component),
  ]
  return { fiscalYear, prefix: segments.join('-') }
}

export function opportunityCodePrefix(input: OpportunityCodeInput, today: Date = new Date()): string {
  return opportunityCodeParts(input, today).prefix
}

/** Plain integer sequence, no leading zeros; `#` for a preview. */
export function formatOpportunityCode(prefix: string, seq: number | typeof OPPORTUNITY_CODE_PLACEHOLDER): string {
  return `${prefix}-${seq}`
}

/** The fiscal year and sequence number a stored code carries, or null. */
export function parseOpportunityCode(code: string | null | undefined): { fiscalYear: string; seq: number } | null {
  const m = /^(FY\d{2})-.*-(\d+)$/.exec(code ?? '')
  return m ? { fiscalYear: m[1], seq: Number(m[2]) } : null
}

/** Allocates the next code for `prefix` from a per-fiscal-year counter map
 *  (`{ FY27: 15 }` = the next FY27 number is 15), skipping any number that an
 *  `existingCodes` entry of the same fiscal year already uses — a lost or
 *  stale counter can never hand out a duplicate. Returns the code and the
 *  updated counters; the input map is not modified. Used by the local store
 *  and its migration; the API allocates from `opportunity_code_sequences`. */
export function allocateOpportunityCode(
  parts: { fiscalYear: string; prefix: string },
  sequences: Readonly<Record<string, number>>,
  existingCodes: Iterable<string | null | undefined>,
): { code: string; sequences: Record<string, number> } {
  const used = new Set<number>()
  for (const code of existingCodes) {
    const parsed = parseOpportunityCode(code)
    if (parsed?.fiscalYear === parts.fiscalYear) used.add(parsed.seq)
  }
  let seq = Math.max(1, Math.floor(sequences[parts.fiscalYear] ?? 1))
  while (used.has(seq)) seq++
  return { code: formatOpportunityCode(parts.prefix, seq), sequences: { ...sequences, [parts.fiscalYear]: seq + 1 } }
}

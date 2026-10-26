import { BID_STAGES, isAtOrAfterSubmitted } from './bids.js'
import { OPPORTUNITY_TYPES } from './opportunityCode.js'
import { GENERAL_FIELDS } from './bidGeneral.js'
import { coerceCustomValue, type CustomFieldType, type CustomValue } from './bidCustomFields.js'
import { BID_SYSTEM_FIELDS } from './bidTrackerFields.js'

export type BidCell = string | number | boolean | null
export interface BidIssue { row: number; column: number; message: string }
export interface BidImportTable {
  headers: string[]; rows: BidCell[][]; cellIssues?: BidIssue[]
  /** Import-wizard choice per column: an app field id, '' = skip the column, null/absent = match by header. */
  mapping?: (string | null)[]
  /** Decision for a row matching an existing bid (key = Excel row number). Required for every match. */
  rowActions?: Record<string, BidRowAction>
}
/** skip = ignore the row; add = new record with a new Bid ID; override = update the matched record, keeping its Bid ID. */
export type BidRowAction = 'skip' | 'add' | 'override'
export interface BidImportMatch {
  row: number; existingId: string; existingName: string; existingCode?: string; action?: BidRowAction
  /** Fields the file would change on Override (blank cells never clear a value). */
  diffs: { field: string; label: string; before: string; after: string }[]
}
export interface BidTransferField { id: string; label: string; type: CustomFieldType | 'datetime'; options?: readonly string[]; team?: string }
export interface BidTransferContext {
  existing: { opportunityName: string; gemTenderId: string; id?: string; bidCode?: string
    /** Current values keyed by app field id, for the Override diff. */
    current?: Record<string, string> }[]
  people: { id: string; name: string; email?: string; mobile?: string; team: string }[]
  states: { id: string; name: string }[]
  departments: { id: string; name: string; stateCode?: number | null }[]
  customFields: { id: string; key: string; name: string; dataType: CustomFieldType; options?: string[] | null }[]
  /** Settings > Masters > Verticals names. When given, a Vertical is matched to its master spelling. */
  verticals?: string[]
}
export interface PreparedBidImport {
  values: Record<string, CustomValue>
  /** Historical values with no app destination (or that could not be linked), keyed by the
   *  original column header. Stored with the bid as a "Historical import" record — never dropped. */
  legacy: Record<string, string>
  /** Excel row number; 'override' updates `targetId` (an opportunity id) instead of adding a bid. */
  row?: number; mode?: 'add' | 'override'; targetId?: string
}
export interface BidImportPreview {
  valid: boolean; rowCount: number
  /** Blocking: any issue rejects the whole batch. */
  issues: BidIssue[]
  /** Non-blocking: the value was converted, kept as historical text, or derived. Review before adding. */
  warnings?: BidIssue[]
  changes: { row: number; column: number; before: string; after: string }[]
  prepared: PreparedBidImport[]
  /** Rows matching an existing bid, with the user's decision and the Override diff. */
  matches?: BidImportMatch[]
  /** Rows the user chose to skip. */
  skipped?: number[]
}
export type BidImportResult = { status: 'imported'; count: number } | { status: 'rejected'; preview: BidImportPreview }
export const BID_IMPORT_MAX_COLUMNS = 100
/** Audit-log field under which each imported bid's historical-only values are stored. */
export const BID_LEGACY_AUDIT_FIELD = 'historicalImport'

const NATIVE_FIELDS: BidTransferField[] = [
  { id: 'opportunityName', label: 'Opportunity Name', type: 'text' },
  { id: 'gemTenderId', label: 'Tender ID', type: 'text' },
  { id: 'assignmentName', label: 'Name of Assignment', type: 'text' },
  { id: 'referenceNo', label: 'Reference/Bid No.', type: 'text' },
  { id: 'departmentId', label: 'Department / Client', type: 'department' },
  { id: 'stateCode', label: 'State', type: 'state' },
  // Options: Settings > Masters > Verticals (commercial `verticals` master). Historical column "SBU".
  { id: 'vertical', label: 'Vertical', type: 'text' },
  { id: 'opportunityType', label: 'Opportunity Type', type: 'select', options: OPPORTUNITY_TYPES },
  { id: 'publishDate', label: 'RFP Published Date', type: 'date' },
  { id: 'submissionDate', label: 'Submission Deadline', type: 'date' },
  { id: 'valueAmount', label: 'Tender Value (In Cr, Excluding Tax)', type: 'currency' },
  { id: 'emdAmount', label: 'Tender EMD', type: 'currency' },
  { id: 'tenderLink', label: 'Tender Link', type: 'url' },
  { id: 'stageKey', label: 'Bid Stage', type: 'select', options: BID_STAGES.map(s => s.key) },
  { id: 'decision', label: 'Decision', type: 'select', options: ['pending', 'go', 'no_go'] },
  { id: 'geoSalesPersonId', label: 'Geo-sales', type: 'person', team: 'sales' },
  { id: 'buSalesPersonId', label: 'BU-sales', type: 'person', team: 'sales' },
  { id: 'preSalesPersonId', label: 'Pre-sales', type: 'person', team: 'preSales' },
  { id: 'bidTeamMemberId', label: 'Bid', type: 'person', team: 'bid' },
  { id: 'ownerEmail', label: 'Bid Owner', type: 'person', team: 'sales' },
]
/** Historical tracker column → app field (GOMS historical-Excel mapping). Columns absent
 *  here have no app destination and are kept as historical values with the bid. */
const IMPORT_TARGETS: Record<string, string> = {
  opportunityName: 'opportunityName', gemTenderId: 'gemTenderId', rfpDescription: 'assignmentName', sbu: 'vertical',
  scope: 'general:scopeOfWork', tenderValue: 'valueAmount', publishDate: 'publishDate', receivedDate: 'general:receivingDate',
  querySubmission: 'general:queriesDeadline', preBidDate: 'general:preBidMeeting', dueDate: 'general:bidDeadline', submissionDate: 'submissionDate',
  pqCompliance: 'general:pqCompliance', tqCompliance: 'general:tqCompliance', tenderFee: 'general:tenderFee', tenderEmd: 'emdAmount',
  evaluationType: 'general:evaluationCriteria', submissionType: 'general:submissionMode',
  salesPersonEmail: 'geoSalesPersonId', state: 'stateCode', verticalOwner: 'buSalesPersonId', presalesOwner: 'preSalesPersonId',
  bidTeamOwner: 'ownerEmail', bidTeamLead: 'bidTeamMemberId', stageKey: 'stageKey', goNoGo: 'decision', tenderWebsite: 'tenderLink',
}
/** Historical column → built-in Live Bids field (bidTrackerFields.ts importKeys). */
const SYSTEM_IMPORT_TARGETS: Record<string, string> = Object.fromEntries(
  BID_SYSTEM_FIELDS.flatMap(f => (f.importKeys ?? []).map(k => [k, `custom:${f.key}`])))
export function bidTransferFields(context: BidTransferContext): BidTransferField[] {
  return [...NATIVE_FIELDS, ...GENERAL_FIELDS.map(f => ({ id: `general:${f.key}`, label: f.label,
    type: (f.kind === 'select' ? 'select' : f.kind === 'date' ? 'date' : f.kind === 'datetime' ? 'datetime' : 'text') as BidTransferField['type'], options: f.options })),
    ...context.customFields.map(f => ({ id: `custom:${f.key}`, label: f.name, type: f.dataType, options: f.options ?? undefined }))]
}
export function resolveBidTransferField(header: string, fields: BidTransferField[]): BidTransferField | undefined {
  const key = bidHeaderKey(header), supplied = findBidField(header)
  const direct = fields.filter(f => bidHeaderKey(f.id) === key || bidHeaderKey(f.label) === key)
  if (direct.length === 1) return direct[0]
  if (direct.length > 1) return direct.find(f => f.id === header) ?? direct.find(f => !f.id.includes(':'))
  return supplied ? fields.find(f => f.id === (IMPORT_TARGETS[supplied.key] ?? SYSTEM_IMPORT_TARGETS[supplied.key])) : undefined
}
/** Wizard choice: import no app field, but keep the column's values with each bid as history. */
export const BID_IMPORT_KEEP_AS_HISTORY = '#history'
/** The app field a column imports into: the wizard's choice when made, otherwise matched by header. */
export function bidImportTarget(table: BidImportTable, column: number, fields: BidTransferField[]): BidTransferField | undefined {
  const choice = table.mapping?.[column]
  if (choice === '' || choice === BID_IMPORT_KEEP_AS_HISTORY) return undefined
  if (choice) return fields.find(f => f.id === choice)
  const header = String(table.headers[column] ?? '')
  return header.trim() ? resolveBidTransferField(header, fields) : undefined
}
/** True when the wizard marked the column "Skip": its values are not imported or kept. */
export const isSkippedBidColumn = (table: BidImportTable, column: number) => table.mapping?.[column] === ''

/** Placeholder text historical trackers use for "no value". Treated as blank, never as data. */
const BLANK = /^(?:n\/?a|nil|null|none|not applicable|not available|tbd|tba|-+|—|\.|0?\/0?)$/i
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const monthOf = (word: string): number | undefined => MONTHS[word.slice(0, 4).toLowerCase()] ?? MONTHS[word.slice(0, 3).toLowerCase()]
function isoDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (y < 1900 || y > 2199) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null
}
/** Accepts the date shapes found in historical trackers: DD/MM/YYYY (also - or . and 2-digit
 *  years), YYYY-MM-DD, "9 Jan 2026"/"09-Jan-26", and Excel serial numbers. Day-first, as in India.
 *  Returns YYYY-MM-DD, or YYYY-MM-DDTHH:MM when the cell states a time — a time is never invented. */
export function parseImportDate(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, ' ')
  const timeMatch = /^(.*?)(?:[ T,]+(?:at )?(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?\s*([ap]\.?m\.?)?)?(?:\s*hrs?\.?)?$/i.exec(text)
  const datePart = (timeMatch?.[1] ?? text).trim()
  let date: string | null = null, m: RegExpExecArray | null
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart))) date = isoDate(+m[1], +m[2], +m[3])
  else if ((m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(datePart))) date = isoDate(+m[3], +m[2], +m[1])
  else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([a-z]{3,9})[\s\-/.,]*(\d{2}|\d{4})$/i.exec(datePart)) && monthOf(m[2])) date = isoDate(+m[3], monthOf(m[2])!, +m[1])
  else if ((m = /^([a-z]{3,9})[\s\-/.,]*(\d{1,2})(?:st|nd|rd|th)?[\s,]*(\d{4})$/i.exec(datePart)) && monthOf(m[1])) date = isoDate(+m[3], monthOf(m[1])!, +m[2])
  else if ((m = /^(\d{5})(?:\.(\d+))?$/.exec(text)) && +m[1] > 20000 && +m[1] < 80000) {
    // Excel 1900 date system serial (as text, e.g. from CSV); any fraction is the time of day.
    const ms = Math.round((+text - 25569) * 86_400_000)
    const dt = new Date(ms)
    const d = dt.toISOString()
    return m[2] && +`0.${m[2]}` > 0 ? `${d.slice(0, 10)}T${d.slice(11, 16)}` : d.slice(0, 10)
  }
  if (!date) return null
  if (!timeMatch?.[2]) return date
  let h = +timeMatch[2]
  const min = +timeMatch[3], ampm = timeMatch[4]?.toLowerCase().replace(/\./g, '')
  if (ampm) { if (h < 1 || h > 12) return null; h = (h % 12) + (ampm === 'pm' ? 12 : 0) }
  if (h > 23 || min > 59) return null
  return `${date}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const UNIT_POWER: Record<string, number> = { cr: 7, crs: 7, crore: 7, crores: 7, l: 5, lac: 5, lacs: 5, lakh: 5, lakhs: 5, k: 3, thousand: 3 }
/** INR amount with optional ₹/Rs/INR and a unit word, returned in `unit` ('cr' or rupees). ₹11 crore ≠ ₹11. */
export function parseImportAmount(raw: string, unit: 'cr' | 'rupee'): string | null {
  const m = /^(₹|rs\.?|inr)?\s*([\d,]*\.?\d+)\s*(cr|crs|crores?|l|lacs?|lakhs?|k|thousand)?\.?\s*(\/-)?$/i.exec(raw.trim())
  if (!m) return null
  const digits = m[2].replace(/,/g, '')
  if (!/^\d*\.?\d+$/.test(digits) || Number(digits) > 1e15) return null
  const n = digits.startsWith('.') ? `0${digits}` : digits
  const word = m[3]?.toLowerCase()
  // A bare number is already in the column's unit; a ₹/Rs/INR or "/-" figure without a unit word is rupees.
  if (!word) return (m[1] || m[4]) && unit === 'cr' ? scaleBidAmount(n, -7) : scaleBidAmount(n, 0)
  return scaleBidAmount(n, UNIT_POWER[word] - (unit === 'cr' ? 7 : 0))
}

/** Opportunity Type from explicit wording only; earliest match wins. */
const TYPE_PATTERNS: readonly [(typeof OPPORTUNITY_TYPES)[number], RegExp][] = [
  ['RFP', /\bRFP\b|request\s+for\s+proposals?\b/i],
  ['RFQ', /\bRFQ\b|request\s+for\s+quot(?:e|ation)s?\b/i],
  ['EOI', /\bEOI\b|expression\s+of\s+interest\b/i],
  ['RFI', /\bRFI\b|request\s+for\s+information\b/i],
  ['GeM', /\bGeM\b|government\s+e-?market\s*place/i],
  ['Tender', /\bNIT\b|notice\s+inviting\s+tenders?\b|\be-?tender\b/i],
]
export function deriveOpportunityType(...texts: string[]): string {
  for (const text of texts) {
    let best: { type: string; at: number } | null = null
    for (const [type, re] of TYPE_PATTERNS) {
      const m = re.exec(text ?? '')
      if (m && (!best || m.index < best.at)) best = { type, at: m.index }
    }
    if (best) return best.type
  }
  return ''
}
/** Historical decision vocabulary → app decision. */
function decisionOf(raw: string): 'go' | 'no_go' | 'pending' | null {
  const v = identity(raw).replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ')
  if (/^(go|yes|approved|y)$/.test(v)) return 'go'
  if (/^(no ?go|no|rejected|n|not approved|dropped)$/.test(v)) return 'no_go'
  if (/under ?approval|pending|awaited|in ?progress/.test(v)) return 'pending'
  return null
}
/** Historical "Tender Stage" wording with an unambiguous app stage. */
const STAGE_SYNONYMS: Record<string, string> = {
  'bid submitted': 'submitted', 'submission done': 'submitted', 'technical bid submitted': 'submitted', 'under evaluation': 'submitted',
  'technical evaluation': 'submitted', 'financial evaluation': 'submitted', 'evaluation': 'submitted',
  'pre bid': 'preBidQueries', 'prebid': 'preBidQueries', 'pre bid queries': 'preBidQueries', 'queries': 'preBidQueries',
  'commercial': 'commercialProposal', 'commercial proposal': 'commercialProposal', 'qualification': 'qualification', 'qualified': 'qualification',
  'not participated': 'dropped', 'not participating': 'dropped', 'no bid': 'dropped', 'cancelled': 'dropped', 'canceled': 'dropped', 'withdrawn': 'dropped', 'dropped': 'dropped',
}
const selectSynonym = (fieldId: string, raw: string): string | undefined => {
  const v = identity(raw)
  if (fieldId === 'general:submissionMode') return /online|e-?submission|portal|e-?tender/.test(v) && !/offline|physical|both/.test(v) ? 'online' : /^(offline|physical|hard ?copy)$/.test(v) ? 'offline' : undefined
  if (fieldId === 'general:pqCompliance' || fieldId === 'general:tqCompliance') return /^(yes|y|complied|compliant|fully complied|met|100%?)$/.test(v) ? 'complied' : /partial/.test(v) ? 'partially complied' : /^(no|n|not complied|non ?compliant|not met)$/.test(v) ? 'not complied' : undefined
  if (fieldId === 'opportunityType') return OPPORTUNITY_TYPES.find(t => identity(t) === v) ?? (deriveOpportunityType(raw) || undefined)
  return undefined
}

/** Validate against existing app fields and reference lists. Never auto-creates columns,
 * departments, people or opportunities; values that cannot be linked are kept as historical text. */
export function validateBidTransfer(table: BidImportTable, context: BidTransferContext): BidImportPreview {
  const issues: BidIssue[] = [], warnings: BidIssue[] = [], changes: BidImportPreview['changes'] = [], prepared: PreparedBidImport[] = []
  const error = (row: number, column: number, message: string) => issues.push({ row, column, message })
  const warn = (row: number, column: number, message: string) => warnings.push({ row, column, message })
  // Spreadsheet error cells (#N/A, #REF!) carry no value: treat as blank and say so.
  for (const ci of table.cellIssues ?? []) warn(ci.row, ci.column, `${ci.message} Treated as blank.`)
  const blankedCells = new Set((table.cellIssues ?? []).map(ci => `${ci.row}:${ci.column}`))
  const fields = bidTransferFields(context), mapped = table.headers.map((_, c) => bidImportTarget(table, c, fields))
  table.mapping?.forEach((choice, c) => {
    if (choice && choice !== BID_IMPORT_KEEP_AS_HISTORY && !fields.some(f => f.id === choice)) error(1, c, `Mapped to an unknown app field "${choice}". Choose another field or Skip.`)
  })
  const seenHeaders = new Set<string>(), seenTargets = new Map<string, number>()
  mapped.forEach((f, c) => {
    const header = bidHeaderKey(String(table.headers[c] ?? ''))
    if (!header) return
    if (isSkippedBidColumn(table, c)) { warn(1, c, `"${table.headers[c]}" skipped — its values are not imported.`); return }
    if (seenHeaders.has(header)) error(1, c, 'Duplicate header. Keep one column for this field.')
    seenHeaders.add(header)
    if (f && seenTargets.has(f.id)) {
      // Two historical columns feeding one app field: the first one wins, the other is kept as history.
      warn(1, c, `"${table.headers[c]}" and "${table.headers[seenTargets.get(f.id)!]}" both map to ${f.label}; the first is used and this one is kept as a historical value.`)
      mapped[c] = undefined
    } else if (f) seenTargets.set(f.id, c)
    else if (findBidField(String(table.headers[c]))?.key !== 'serial') warn(1, c, `"${table.headers[c]}" has no app field; its values are stored with each bid as historical import data.`)
  })
  if (!mapped.some(f => f?.id === 'opportunityName')) error(1, 0, 'Opportunity Name is required.')
  if (table.headers.length > BID_IMPORT_MAX_COLUMNS) error(1, 0, `Use at most ${BID_IMPORT_MAX_COLUMNS} columns.`)
  const rows = table.rows.map((cells, i) => ({ cells, row: i + 2 })).filter(r => r.cells.some(v => v !== null && String(v).trim()))
  if (!rows.length || rows.length > 500) error(1, 0, 'Use 1–500 nonempty bid rows per batch.')
  const fileNames = new Set<string>(), fileTenders = new Set<string>(), matches: BidImportMatch[] = [], skipped: number[] = []
  const liveMatch = (name: string, tender: string) => context.existing.find(o => (name && identity(o.opportunityName) === name) || (tender && o.gemTenderId && tenderIdentity(o.gemTenderId) === tender))
  for (const { cells, row } of rows.slice(0, 500)) {
    const values: Record<string, CustomValue> = {}, legacy: Record<string, string> = {}
    const keep = (c: number, text: string) => { legacy[String(table.headers[c] ?? `Column ${c + 1}`).trim() || `Column ${c + 1}`] = text }
    cells.slice(table.headers.length).forEach((v, i) => { if (v !== null && String(v).trim()) { keep(table.headers.length + i, String(v).trim()); warn(row, table.headers.length + i, 'Value has no column header; kept as historical data.') } })
    mapped.forEach((field, c) => {
      const raw = cells[c] === null || cells[c] === undefined || blankedCells.has(`${row}:${c}`) ? '' : String(cells[c]), text = raw.trim()
      const supplied = findBidField(String(table.headers[c] ?? ''))
      if (isSkippedBidColumn(table, c)) return
      const isOption = !!field?.options?.some(o => bidHeaderKey(o) === bidHeaderKey(text))
      if (!text || (BLANK.test(text) && !isOption)) { if (field?.id === 'opportunityName') error(row, c, 'Opportunity Name is required.'); return }
      if (supplied?.key === 'serial') return
      if (text.length > 5000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) { error(row, c, 'Use plain values up to 5,000 characters, without control characters.'); return }
      // Formula text (e.g. from a CSV) would execute when an export is opened. Excel formulas arrive as their calculated value.
      if (/^[=+@]/.test(text) && !/^\+\d/.test(text)) { error(row, c, 'Formula text is not accepted. Paste the calculated value instead.'); return }
      if (!field) { keep(c, text); return }
      // A value that cannot be linked or parsed is kept as history (never blocks), except for the name.
      const soft = (message: string) => { keep(c, text); warn(row, c, `${message} Kept as historical text "${text.slice(0, 80)}".`) }
      let value: unknown = text
      if (field.type === 'date' || field.type === 'datetime') {
        const parsed = parseImportDate(text)
        if (!parsed) return soft('Not a recognisable date.')
        value = field.type === 'date' ? parsed.slice(0, 10) : parsed
      } else if (field.id === 'valueAmount' || field.id === 'emdAmount') {
        const amount = parseImportAmount(text, field.id === 'valueAmount' ? 'cr' : 'rupee')
        if (amount === null) return soft(field.id === 'valueAmount' ? 'Not an INR amount (crore).' : 'Not an INR amount (rupees).')
        value = amount
      } else if (field.type === 'person' || field.type === 'department' || field.type === 'state') {
        const pool = field.type === 'person' ? context.people.filter(p => p.team === (field.team ?? 'sales')) : field.type === 'department' ? context.departments : context.states
        const mobile = normalizeBidMobile(text)
        const matches = pool.filter(p => identity(p.id) === identity(text) || identity(p.name) === identity(text) || ('email' in p && identity(String(p.email ?? '')) === identity(text)) || (mobile && 'mobile' in p && normalizeBidMobile(String(p.mobile ?? '')) === mobile))
        // A unique first-name / prefix match is accepted for people ("Ashish" → "Ashish Desai").
        const loose = field.type === 'person' && !matches.length ? pool.filter(p => identity(p.name).split(' ')[0] === identity(text) || identity(p.name).startsWith(identity(text) + ' ')) : []
        const found = matches.length ? matches : loose
        if (found.length !== 1) return soft(found.length ? `Matches ${found.length} ${field.team ?? field.type} records; not linked.` : `No matching ${field.team ?? field.type} record in the app; not linked.`)
        if (loose.length) warn(row, c, `"${text}" linked to ${found[0].name} by first name. Check it is the right person.`)
        value = field.id === 'ownerEmail' ? context.people.find(p => p.id === found[0].id)?.email : found[0].id
        if (field.id === 'ownerEmail' && !value) return soft('The matched owner has no official email.')
      } else if (field.type === 'multiselect') {
        // "BG, Online / DD" → each part matched to an option; unmatched parts are reported and kept as history.
        const parts = text.split(/\s*(?:[,;|/\n]|\band\b|&)\s*/i).map(t => t.trim()).filter(Boolean)
        const picked = parts.map(t => field.options?.find(o => bidHeaderKey(o) === bidHeaderKey(t)))
        const unknown = parts.filter((_, i) => !picked[i])
        if (!picked.some(Boolean)) return soft(`Not one of ${field.options?.join(', ')}.`)
        if (unknown.length) { keep(c, text); warn(row, c, `${unknown.join(', ')} not in the list; kept as history.`) }
        value = JSON.stringify((field.options ?? []).filter(o => picked.includes(o)))
      } else if (field.type === 'select') {
        let option: string | undefined = field.options?.find(v => bidHeaderKey(v) === bidHeaderKey(text))
        if (!option && field.id === 'stageKey') option = BID_STAGES.find(s => bidHeaderKey(s.label) === bidHeaderKey(text))?.key ?? STAGE_SYNONYMS[identity(text).replace(/[-_/]+/g, ' ')]
        if (!option && field.id === 'decision') option = decisionOf(text) ?? undefined
        if (!option) option = selectSynonym(field.id, text)
        if (!option) return soft(`Not one of ${field.options?.join(', ')}.`)
        value = option
      } else if (field.id === 'vertical' && context.verticals?.length) {
        const master = context.verticals.find(v => identity(v) === identity(text))
        if (!master) return soft(`Not in Settings > Masters > Verticals (${context.verticals.join(', ')}).`)
        value = master
      } else if (field.type === 'phone') {
        const mobile = normalizeBidMobile(text)
        if (!mobile) return soft('Not a 10-digit Indian mobile.')
        value = mobile
      }
      if (field.type !== 'datetime' && !['ownerEmail', 'valueAmount', 'emdAmount'].includes(field.id)) {
        try { value = coerceCustomValue(field.type, value, field.options ? [...field.options] : undefined) }
        catch (e) { return soft(e instanceof Error ? e.message : 'Invalid value for this app field.') }
      }
      values[field.id] = value as CustomValue
      if (String(value ?? '') !== raw) changes.push({ row, column: c, before: raw, after: String(value ?? '') })
    })
    const column = (key: string) => Math.max(0, mapped.findIndex(f => f?.id === key))
    const headerCol = (key: string) => Math.max(0, table.headers.findIndex(h => findBidField(String(h ?? ''))?.key === key))
    // Derived fields — filled only from explicit evidence in the row.
    if (values.opportunityType === undefined) {
      const type = deriveOpportunityType(String(values.assignmentName ?? ''), String(values.opportunityName ?? ''), String(values.gemTenderId ?? ''))
        || (/\bGEM\/\d{4}\/B\//i.test(String(values.gemTenderId ?? '')) ? 'GeM' : '')
      if (type) { values.opportunityType = type; warn(row, column('assignmentName'), `Opportunity Type set to ${type} from the assignment wording.`) }
    }
    if (values.submissionDate === undefined && typeof values['general:bidDeadline'] === 'string') values.submissionDate = String(values['general:bidDeadline']).slice(0, 10)
    // The app does not allow Go before Submitted: keep the decision as history instead of rejecting the bid.
    if (values.decision === 'go' && !isAtOrAfterSubmitted(String(values.stageKey ?? 'solutioning'))) {
      values.decision = 'pending'
      legacy['Decision (historical)'] = 'Go'
      warn(row, column('decision') || headerCol('goNoGo'), 'Go is only allowed from the Submitted stage; imported as Pending and the original Go kept as history.')
    }
    const name = identity(String(values.opportunityName ?? '')), tender = tenderIdentity(String(values.gemTenderId ?? ''))
    const action = table.rowActions?.[String(row)], live = liveMatch(name, tender)
    const matchColumn = live && name && identity(live.opportunityName) === name ? column('opportunityName') : column('gemTenderId')
    let mode: 'add' | 'override' = 'add', targetId: string | undefined
    if (live) {
      const diffs = Object.entries(values).flatMap(([field, value]) => {
        const after = String(value ?? ''), before = live.current?.[field] ?? ''
        return after && after !== before ? [{ field, label: fields.find(f => f.id === field)?.label ?? field, before, after }] : []
      })
      matches.push({ row, existingId: live.id ?? '', existingName: live.opportunityName, existingCode: live.bidCode, action, diffs })
      if (!action) error(row, matchColumn, `Matches existing bid "${live.opportunityName}". Choose Skip, Add as duplicate or Override.`)
      else if (action === 'skip') { skipped.push(row); continue }
      else if (action === 'override') {
        if (!live.id) error(row, matchColumn, 'This bid cannot be overridden. Choose Skip or Add as duplicate.')
        mode = 'override'; targetId = live.id
      }
    } else if ((name && fileNames.has(name)) || (tender && fileTenders.has(tender))) {
      matches.push({ row, existingId: '', existingName: 'an earlier row in this file', action, diffs: [] })
      if (action === 'skip') { skipped.push(row); continue }
      if (action !== 'add') error(row, name && fileNames.has(name) ? column('opportunityName') : column('gemTenderId'), 'Repeats an earlier row in this file. Choose Skip or Add as duplicate.')
    }
    if (name) fileNames.add(name); if (tender) fileTenders.add(tender)
    const dept = context.departments.find(d => d.id === values.departmentId)
    if (dept && values.stateCode !== undefined && dept.stateCode !== Number(values.stateCode)) {
      legacy.State = String(context.states.find(s => s.id === String(values.stateCode))?.name ?? values.stateCode)
      delete values.stateCode
      warn(row, column('departmentId'), 'State differs from the department; the department\'s state is used and the sheet value kept as history.')
    }
    prepared.push({ values, legacy, row, mode, targetId })
  }
  return { valid: !issues.length, rowCount: rows.length - skipped.length, issues, warnings, changes, prepared: issues.length ? [] : prepared, matches, skipped }
}

type FieldKind = 'text' | 'date' | 'money' | 'percent' | 'owner' | 'state' | 'stage' | 'url' | 'quarter' | 'serial' | 'choice'
export interface BidField {
  key: string
  label: string
  kind: FieldKind
  choices?: readonly string[]
  aliases?: readonly string[]
  visible?: boolean
  required?: boolean
}
const field = (key: string, label: string, kind: FieldKind = 'text', extra: Partial<BidField> = {}): BidField => ({ key, label, kind, ...extra })
const yesNo = ['Yes', 'No']

/** Single schema used by the tracker, spreadsheet template and BOTH import boundaries. */
export const BID_FIELDS: readonly BidField[] = [
  field('serial', '#', 'serial'),
  field('opportunityName', 'Opportunity Name', 'text', { required: true, visible: true }),
  field('rfpDescription', 'RFP Description'),
  field('sbu', 'SBU', 'text', { visible: true }),
  field('temperature', 'Hot / Cold', 'choice', { choices: ['Hot', 'Cold'], visible: true }),
  field('scope', 'Scope'),
  field('tenderValue', 'Tender Value (In Cr, Excluding Tax)', 'money', { visible: true, aliases: ['Tender Value', 'Tender Value (In Cr, Excluding Tax)'] }),
  field('publishDate', 'RFP Published Date (DD/MM/YYYY)', 'date', { aliases: ['RFP Published Date'] }),
  field('receivedDate', 'RFP Received Date (DD/MM/YYYY)', 'date', { aliases: ['RFP Received Date'] }),
  field('querySubmission', 'Query Submission (As per RFP)', 'date'),
  field('preBidDate', 'Pre Bid Meeting Date', 'date'),
  field('pbResponseDate', 'PB Response Published Date', 'date'),
  field('dueDate', 'Due Date of submission', 'date'),
  field('submissionDate', 'Current Date of submission', 'date', { visible: true }),
  field('pqCompliance', 'PQ Compliance'),
  field('tqCompliance', 'TQ Compliance Subjective, Objectivve', 'text', { aliases: ['TQ Compliance', 'TQ Compliance Subjective, Objective'] }),
  field('preCxo', 'Pre Cxo (Yes/No)', 'choice', { choices: yesNo }),
  field('finalCxo', 'Final CxO (Yes/No)', 'choice', { choices: yesNo }),
  field('bidTeamProgress', 'Bid Team Work Status (PQ-TQ) & Eligibility as OEM % (Synopsis, Queries, Response Drafting, Amnex as OEM Documentation, BRT prepration, Internal Co-ordination)', 'percent', { aliases: ['Bid Team Work Status (PQ-TQ) & Eligibility as OEM %'] }),
  field('presalesProgress', 'Pre-sales Technical Status % (Technical solution designing with internal team, OEM interaction, prebid queries, technical proposal)', 'percent', { aliases: ['Pre-sales Technical Status %'] }),
  field('commercialProgress', 'Commerical Working Status %', 'percent', { aliases: ['Commercial Working Status %'] }),
  field('bidApproval', 'Bid Approval Received (Yes/No-Go /Under Approval)', 'choice', { choices: ['Yes', 'No-Go', 'Under Approval'] }),
  field('submissionType', 'Submission Type (Online / Offline / Both)', 'choice', { choices: ['Online', 'Offline', 'Both'] }),
  field('evaluationType', 'Evaluation Type (LCBS / QCBS)', 'choice', { choices: ['LCBS', 'QCBS'] }),
  field('tenderFee', 'Tender Fee', 'money'),
  field('tenderFeeForm', 'Tender Fee in the Form Of'),
  field('tenderFeePaid', 'Tender Fee Paid (Yes/No/NA)', 'choice', { choices: ['Yes', 'No', 'NA'] }),
  field('tenderEmd', 'Tender EMD', 'money'),
  field('tenderEmdForm', 'Tender EMD in the Form Of'),
  field('rtm', 'RTM'),
  field('hpGs', 'HP / GS', 'choice', { choices: ['HP', 'GS'] }),
  field('bidTeamOwner', 'Bid Team Owner', 'owner'),
  field('bidTeamLead', 'Bid Team Lead', 'owner'),
  field('presalesOwner', 'Presales Owner', 'owner'),
  field('presalesLead', 'Presales Lead', 'owner'),
  field('salesPersonEmail', 'Geo Sales Owner', 'owner', { visible: true }),
  field('state', 'State', 'state', { visible: true }),
  field('zone', 'Zone'),
  field('verticalOwner', 'Vertical Owner', 'owner'),
  field('buOwner', 'BU owner', 'owner'),
  field('stageKey', 'Tender Stage', 'stage', { visible: true }),
  field('tenderStatus', 'Tender Status', 'text', { visible: true }),
  field('emdRefund', 'EMD refund RECEIVED (Yes/ No)', 'choice', { choices: yesNo }),
  field('participantNotes', 'Participant List/ Reason of Bid Lost or not participating'),
  field('receivedQuarter', 'Qtr - RFP Received', 'quarter'),
  field('submittedQuarter', 'Qtr - RFP Submitted', 'quarter'),
  field('statusToday', 'Status from Today'),
  field('financialOpeningDate', 'Financial Bid Opening Date', 'date'),
  field('loiDate', 'LOI Date', 'date'),
  field('loaDate', 'LOA / WO Date', 'date'),
  field('agreementDate', 'Agreement Date', 'date'),
  field('tenderFolderUrl', 'Tender Folder Link', 'url'),
  field('crmUrl', 'CRM Link', 'url'),
  field('stage1', 'Stage 1'),
  field('goNoGo', 'Go/No Go', 'choice', { choices: ['Go', 'No Go'] }),
  field('cxo', 'CXO'),
  field('gemTenderId', 'Tender ID', 'text', { visible: true }),
  field('tenderWebsite', 'Tender Website', 'url'),
]


export function bidHeaderKey(value: string): string {
  return value.replace(/&#x20;|&nbsp;|<br\s*\/?\s*>/gi, ' ').normalize('NFKC').toLowerCase().replace(/[^a-z0-9#]/g, '')
}
export function findBidField(header: string): BidField | undefined {
  const key = bidHeaderKey(header)
  return BID_FIELDS.find(f => [f.key, f.label, ...(f.aliases ?? [])].some(h => bidHeaderKey(h) === key))
}
const identity = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
const tenderIdentity = (s: string) => identity(s).replace(/\s/g, '')

/** Accept only explicit Indian prefixes; never truncate arbitrary extra digits. */
export function normalizeBidMobile(value: string): string | null {
  let n = value.trim().replace(/[\s()-]/g, '')
  if (/^\+91[6-9]\d{9}$/.test(n)) n = n.slice(3)
  else if (/^0091[6-9]\d{9}$/.test(n)) n = n.slice(4)
  else if (/^91[6-9]\d{9}$/.test(n)) n = n.slice(2)
  else if (/^0[6-9]\d{9}$/.test(n)) n = n.slice(1)
  return /^[6-9]\d{9}$/.test(n) ? n : null
}

/** Decimal unit conversion without rounding monetary digits through a JS number. */
export function scaleBidAmount(value: string, decimalPlaces: number): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value
  const [whole, fraction = ''] = value.split('.')
  const digits = whole + fraction, split = whole.length + decimalPlaces
  const shifted = split <= 0 ? `0.${'0'.repeat(-split)}${digits}` : split >= digits.length
    ? digits + '0'.repeat(split - digits.length) : `${digits.slice(0, split)}.${digits.slice(split)}`
  const [integer, decimals = ''] = shifted.split('.')
  const normalized = integer.replace(/^0+(?=\d)/, ''), tail = decimals.replace(/0+$/, '')
  return tail ? `${normalized}.${tail}` : normalized
}



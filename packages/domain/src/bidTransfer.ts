import { BID_STAGES, isAtOrAfterSubmitted } from './bids.js'
import { OPPORTUNITY_TYPES } from './opportunityCode.js'
import { GENERAL_FIELDS } from './bidGeneral.js'
import { coerceCustomValue, type CustomFieldType, type CustomValue } from './bidCustomFields.js'

export type BidCell = string | number | boolean | null
export interface BidIssue { row: number; column: number; message: string }
export interface BidImportTable { headers: string[]; rows: BidCell[][]; cellIssues?: BidIssue[] }
export interface BidTransferField { id: string; label: string; type: CustomFieldType | 'datetime'; options?: readonly string[]; team?: string }
export interface BidTransferContext {
  existing: { opportunityName: string; gemTenderId: string }[]
  people: { id: string; name: string; email?: string; mobile?: string; team: string }[]
  states: { id: string; name: string }[]
  departments: { id: string; name: string; stateCode?: number | null }[]
  customFields: { id: string; key: string; name: string; dataType: CustomFieldType; options?: string[] | null }[]
}
export interface PreparedBidImport { values: Record<string, CustomValue> }
export interface BidImportPreview {
  valid: boolean; rowCount: number; issues: BidIssue[]
  changes: { row: number; column: number; before: string; after: string }[]
  prepared: PreparedBidImport[]
}
export type BidImportResult = { status: 'imported'; count: number } | { status: 'rejected'; preview: BidImportPreview }
export const BID_IMPORT_MAX_COLUMNS = 100

const NATIVE_FIELDS: BidTransferField[] = [
  { id: 'opportunityName', label: 'Opportunity Name', type: 'text' },
  { id: 'gemTenderId', label: 'Tender ID', type: 'text' },
  { id: 'assignmentName', label: 'Name of Assignment', type: 'text' },
  { id: 'referenceNo', label: 'Reference/Bid No.', type: 'text' },
  { id: 'departmentId', label: 'Department / Client', type: 'department' },
  { id: 'stateCode', label: 'State', type: 'state' },
  { id: 'vertical', label: 'Sector', type: 'text' },
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
const IMPORT_TARGETS: Record<string, string> = {
  opportunityName: 'opportunityName', gemTenderId: 'gemTenderId', rfpDescription: 'assignmentName',
  scope: 'general:scopeOfWork', tenderValue: 'valueAmount', publishDate: 'publishDate', receivedDate: 'general:receivingDate',
  querySubmission: 'general:queriesDeadline', preBidDate: 'general:preBidMeeting', submissionDate: 'submissionDate',
  pqCompliance: 'general:pqCompliance', tqCompliance: 'general:tqCompliance', tenderFee: 'general:tenderFee', tenderEmd: 'emdAmount',
  evaluationType: 'general:evaluationCriteria', submissionType: 'general:submissionMode',
  salesPersonEmail: 'geoSalesPersonId', state: 'stateCode', buOwner: 'buSalesPersonId', presalesOwner: 'preSalesPersonId',
  bidTeamOwner: 'bidTeamMemberId', stageKey: 'stageKey', goNoGo: 'decision', tenderWebsite: 'tenderLink',
}
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
  return supplied ? fields.find(f => f.id === IMPORT_TARGETS[supplied.key]) : undefined
}
function importDate(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(iso + 'T00:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
}

/** Validate against existing app fields and reference lists. No automatic column,
 * department, person or opportunity updates are permitted by this import path. */
export function validateBidTransfer(table: BidImportTable, context: BidTransferContext): BidImportPreview {
  const issues: BidIssue[] = [...(table.cellIssues ?? [])], changes: BidImportPreview['changes'] = [], prepared: PreparedBidImport[] = []
  const error = (row: number, column: number, message: string) => issues.push({ row, column, message })
  const fields = bidTransferFields(context), mapped = table.headers.map(h => resolveBidTransferField(h, fields))
  const seenHeaders = new Set<string>(), seenTargets = new Set<string>()
  mapped.forEach((f, c) => {
    const header = bidHeaderKey(table.headers[c])
    if (seenHeaders.has(header)) error(1, c, 'Duplicate header. Keep one column for this field.')
    seenHeaders.add(header)
    if (f && seenTargets.has(f.id)) error(1, c, 'Two columns target the same app field. Keep one value column.')
    if (f) seenTargets.add(f.id)
    else if (!findBidField(table.headers[c])) error(1, c, 'Unknown or ambiguous app column. Use a supported field ID/name from the export or import template.')
  })
  if (!mapped.some(f => f?.id === 'opportunityName')) error(1, 0, 'Opportunity Name is required.')
  if (table.headers.length > 100) error(1, 0, 'Use at most 100 columns.')
  const rows = table.rows.map((cells, i) => ({ cells, row: i + 2 })).filter(r => r.cells.some(v => v !== null && String(v).trim()))
  if (!rows.length || rows.length > 500) error(1, 0, 'Use 1–500 nonempty bid rows per batch.')
  const names = new Set(context.existing.map(o => identity(o.opportunityName)))
  const tenders = new Set(context.existing.filter(o => o.gemTenderId).map(o => tenderIdentity(o.gemTenderId)))
  for (const { cells, row } of rows.slice(0, 500)) {
    const values: Record<string, CustomValue> = {}
    if (cells.slice(table.headers.length).some(v => v !== null && String(v).trim())) error(row, table.headers.length, 'Value has no column header.')
    mapped.forEach((field, c) => {
      const raw = cells[c] === null || cells[c] === undefined ? '' : String(cells[c]), text = raw.trim()
      const supplied = findBidField(table.headers[c])
      if (!text) { if (field?.id === 'opportunityName') error(row, c, 'Opportunity Name is required.'); return }
      if (supplied?.key === 'serial') { if (!/^\d+$/.test(text)) error(row, c, 'Row number must be a whole number.'); return }
      if (!field) { error(row, c, 'No matching field exists in the current app. Rename this column to an existing app field or add that field separately, then re-upload. No value was discarded.'); return }
      try {
        if (text.startsWith('=') || text.length > 5000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new Error('Use plain values up to 5,000 characters, without formulas or control characters.')
        let value: unknown = text
        if (supplied?.kind === 'percent') {
          const n = Number(text.replace(/%$/, '').trim())
          if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Enter a percentage from 0 to 100.')
          value = String(n)
        }
        if (field.type === 'date' || field.type === 'datetime') {
          const date = importDate(text)
          if (date) value = date
          else if (field.type === 'datetime' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) && importDate(text.slice(0, 10)) && +text.slice(11,13) < 24 && +text.slice(14,16) < 60 && (text.length === 16 || +text.slice(17,19) < 60)) value = text
          else throw new Error('Invalid calendar date. Use DD/MM/YYYY or YYYY-MM-DD; date/time fields also accept YYYY-MM-DDTHH:MM.')
        } else if (field.type === 'person' || field.type === 'department' || field.type === 'state') {
          const people = field.type === 'person' ? context.people.filter(p => p.team === (field.team ?? 'sales')) : field.type === 'department' ? context.departments : context.states
          const mobile = normalizeBidMobile(text)
          const matches = people.filter(p => identity(p.id) === identity(text) || identity(p.name) === identity(text) || ('email' in p && identity(String(p.email ?? '')) === identity(text)) || (mobile && 'mobile' in p && normalizeBidMobile(String(p.mobile ?? '')) === mobile))
          if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous reference. Use the unique existing record ID or official email.' : `No matching active ${field.team ?? field.type} record. No master records are auto-created.`)
          value = field.id === 'ownerEmail' ? context.people.find(p => p.id === matches[0].id)?.email : matches[0].id
          if (field.id === 'ownerEmail' && !value) throw new Error('The selected owner has no official email. Correct the roster first.')
        } else if (field.type === 'select') {
          const option = field.options?.find(v => bidHeaderKey(v) === bidHeaderKey(text))
            ?? (field.id === 'stageKey' ? BID_STAGES.find(s => bidHeaderKey(s.label) === bidHeaderKey(text))?.key : undefined)
          if (!option) throw new Error(`Choose ${field.options?.join(', ')}.`)
          value = option
        } else if (field.type === 'phone') {
          const mobile = normalizeBidMobile(text)
          if (!mobile) throw new Error('Use a 10-digit Indian mobile; spaces and explicit 0/+91/0091 prefixes are normalized.')
          value = mobile
        }
        if (field.type !== 'datetime' && !['ownerEmail', 'valueAmount', 'emdAmount'].includes(field.id)) value = coerceCustomValue(field.type, value, field.options ? [...field.options] : undefined)
        if (field.id === 'valueAmount' || field.id === 'emdAmount') {
          if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(text) || Number(text.replace(/,/g,'')) > 1e15) throw new Error('Enter a nonnegative amount with valid comma grouping; no currency symbols. Tender Value is INR crore; EMD is INR rupees.')
          value = text.replace(/,/g,'')
        }
        values[field.id] = value as CustomValue
        if (String(value ?? '') !== raw) changes.push({ row, column: c, before: raw, after: String(value ?? '') })
      } catch (e) { error(row, c, e instanceof Error ? e.message : 'Invalid value for this app field.') }
    })
    const column = (key: string) => Math.max(0, mapped.findIndex(f => f?.id === key))
    const name = identity(String(values.opportunityName ?? '')), tender = tenderIdentity(String(values.gemTenderId ?? ''))
    if (names.has(name)) error(row, column('opportunityName'), 'Opportunity name already exists live or repeats in this file. Imports only create new bids; existing rows are never updated.')
    if (tender && tenders.has(tender)) error(row, column('gemTenderId'), 'Tender ID already exists live or repeats in this file. No existing opportunity or bid will be overwritten.')
    names.add(name); if (tender) tenders.add(tender)
    if (values.decision === 'go' && !isAtOrAfterSubmitted(String(values.stageKey ?? 'solutioning'))) error(row, column('decision'), 'The app does not allow Go before Submitted.')
    const dept = context.departments.find(d => d.id === values.departmentId)
    if (dept && values.stateCode !== undefined && dept.stateCode !== Number(values.stateCode)) error(row, column('stateCode'), 'State differs from the selected existing department.')
    prepared.push({ values })
  }
  return { valid: !issues.length, rowCount: rows.length, issues, changes, prepared: issues.length ? [] : prepared }
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



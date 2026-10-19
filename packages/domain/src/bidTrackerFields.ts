import type { CustomFieldType } from './bidCustomFields.js'

/** Bid Tracker dropdown masters (Settings → Masters → Bid Tracker). Stored in `commercial_masters`
 *  under these master keys; `name` is the value stored on a bid, `description` its full form
 *  (shown as a tooltip). The seed values below are only the initial list — users maintain them. */
export const BID_TRACKER_MASTERS = [
  { key: 'bidPriorities', label: 'Bid Priority', singular: 'Bid Priority', values: ['Hot', 'Cold'] },
  { key: 'tenderFeeModes', label: 'Tender Fee Payment Modes', singular: 'Payment Mode',
    values: ['NA', 'Online', 'DD', 'NEFT', 'RTGS', 'IMPS', 'Internet Banking', 'BG', 'Cheque', 'Cash', 'Exempted'] },
  { key: 'emdInstruments', label: 'EMD Instruments', singular: 'EMD Instrument', values: [
    ['NA', 'Not Applicable'], ['TBD', 'To Be Decided'], ['Not Specified', 'Not Specified'], ['BG', 'Bank Guarantee'], ['Online', 'Online Payment'],
    ['DD', 'Demand Draft'], ['PO', 'Pay Order'], ['BD', "Banker's Draft"], ['BC', "Banker's Cheque"], ['TC', 'Treasury Challan'],
    ['FDR', 'Fixed Deposit Receipt'], ['FD', 'Fixed Deposit'], ['ISB', 'Insurance Surety Bond'], ['Surety Bond', 'Surety Bond'],
    ['NEFT', 'National Electronic Funds Transfer'], ['RTGS', 'Real Time Gross Settlement'], ['eBG', 'Electronic Bank Guarantee'],
    ['IMPS', 'Immediate Payment Service'], ['Internet Banking', 'Internet Banking'], ['ECS', 'Electronic Clearing Service'],
    ['Insurance Bond', 'Insurance Bond'], ['CDR', 'Call Deposit Receipt'],
  ] },
  { key: 'rtmTypes', label: 'RTM', singular: 'RTM', values: ['Sole', 'OEM', 'TBD', 'Consortium', 'Sub Contractor', 'Lead'] },
  { key: 'zones', label: 'Zones', singular: 'Zone', values: ['East', 'West', 'North', 'South', 'North-Central', 'North-East'] },
  { key: 'tenderStatuses', label: 'Tender Statuses', singular: 'Tender Status', values: [
    'Under Preparation', 'Under Qualification', 'Under Review', 'Pre-Bid Stage', 'Pre-Bid Queries', 'Under Approval', 'Go Approved', 'No-Go',
    'Technical Proposal Preparation', 'Commercial Proposal Preparation', 'Ready for Submission', 'Submitted', 'Under Evaluation',
    'Technical Evaluation', 'Technically Qualified', 'Technically Disqualified', 'Financial Evaluation', 'Financial Bid Opened',
    'Financially Qualified', 'L1 Declared', 'Selected', 'Won', 'Lost', 'LOI Received', 'LOA Issued', 'Work Order Received',
    'Agreement Signed', 'Cancelled', 'Withdrawn', 'Not Participated', 'On Hold', 'Tender Extended', 'Retendering', 'Disqualified',
  ] },
  /** Picked from the global employees list (code = employee id, name = employee name). */
  { key: 'buOwners', label: 'BU Owners', singular: 'BU Owner', values: [] },
] as const satisfies readonly { key: string; label: string; singular: string; values: readonly (string | readonly [string, string])[] }[]

export type BidTrackerMasterKey = (typeof BID_TRACKER_MASTERS)[number]['key']
export const BID_TRACKER_MASTER_KEYS: readonly BidTrackerMasterKey[] = BID_TRACKER_MASTERS.map(m => m.key)
export const isBidTrackerMasterKey = (key: string): key is BidTrackerMasterKey => (BID_TRACKER_MASTER_KEYS as readonly string[]).includes(key)
/** [code, name, description] seed rows for a master. */
export function bidTrackerMasterSeed(key: BidTrackerMasterKey): [string, string, string][] {
  const def = BID_TRACKER_MASTERS.find(m => m.key === key)!
  return def.values.map(v => (typeof v === 'string' ? [v, v, ''] : [v[0], v[0], v[1]]))
}

/** Where a built-in field's dropdown options come from. Options are resolved live from the source on
 *  every read, so a master edit reflects in the grid, Opportunity details and the Import Wizard at once. */
export type BidOptionSource =
  | { kind: 'fixed'; options: readonly string[] }
  | { kind: 'master'; masterKey: BidTrackerMasterKey }
  | { kind: 'competitors' }
  | { kind: 'team'; team: 'preSales' }

export interface BidSystemField {
  key: string; name: string; dataType: CustomFieldType; source?: BidOptionSource
  /** Historical tracker header keys (BID_FIELDS in bidTransfer.ts) that import into this field. */
  importKeys?: readonly string[]
}
const YES_NO = { kind: 'fixed', options: ['Yes', 'No'] } as const

/** Built-in Bid Tracker fields, stored as custom fields with these fixed keys (seeded; name, type and
 *  options are not user-editable — options come from `source`). */
export const BID_SYSTEM_FIELDS: readonly BidSystemField[] = [
  { key: 'bid_priority', name: 'Bid Priority', dataType: 'select', source: { kind: 'master', masterKey: 'bidPriorities' }, importKeys: ['temperature'] },
  { key: 'pb_response_date', name: 'PB Response Published Date', dataType: 'date', importKeys: ['pbResponseDate'] },
  { key: 'pre_cxo', name: 'Pre-CXO', dataType: 'select', source: YES_NO, importKeys: ['preCxo'] },
  { key: 'final_cxo', name: 'Final CXO', dataType: 'select', source: YES_NO, importKeys: ['finalCxo'] },
  { key: 'bid_approval', name: 'Bid Approval Received', dataType: 'select', source: { kind: 'fixed', options: ['Yes', 'No-Go', 'Under Approval'] }, importKeys: ['bidApproval'] },
  { key: 'tender_fee_mode', name: 'Tender Fee in the Form Of', dataType: 'select', source: { kind: 'master', masterKey: 'tenderFeeModes' }, importKeys: ['tenderFeeForm'] },
  { key: 'tender_fee_paid', name: 'Tender Fee Paid', dataType: 'select', source: { kind: 'fixed', options: ['Yes', 'No', 'NA'] }, importKeys: ['tenderFeePaid'] },
  { key: 'emd_mode', name: 'Tender EMD in the Form Of', dataType: 'multiselect', source: { kind: 'master', masterKey: 'emdInstruments' }, importKeys: ['tenderEmdForm'] },
  { key: 'rtm', name: 'RTM', dataType: 'select', source: { kind: 'master', masterKey: 'rtmTypes' }, importKeys: ['rtm'] },
  { key: 'presales_lead', name: 'Presales Lead', dataType: 'select', source: { kind: 'team', team: 'preSales' }, importKeys: ['presalesLead'] },
  { key: 'zone', name: 'Zone', dataType: 'select', source: { kind: 'master', masterKey: 'zones' }, importKeys: ['zone'] },
  { key: 'bu_owner', name: 'BU Owner', dataType: 'select', source: { kind: 'master', masterKey: 'buOwners' }, importKeys: ['buOwner'] },
  { key: 'tender_status', name: 'Tender Status', dataType: 'select', source: { kind: 'master', masterKey: 'tenderStatuses' }, importKeys: ['tenderStatus'] },
  { key: 'emd_refund', name: 'EMD Refund Received', dataType: 'select', source: YES_NO, importKeys: ['emdRefund'] },
  { key: 'participants', name: 'Participant List', dataType: 'multiselect', source: { kind: 'competitors' } },
  { key: 'loss_reason', name: 'Lost / Non-participation Reason', dataType: 'text', importKeys: ['participantNotes'] },
  { key: 'financial_opening_date', name: 'Financial Bid Opening Date', dataType: 'date', importKeys: ['financialOpeningDate'] },
  { key: 'loi_date', name: 'LOI Date', dataType: 'date', importKeys: ['loiDate'] },
  { key: 'loa_date', name: 'LOA / WO Date', dataType: 'date', importKeys: ['loaDate'] },
  { key: 'agreement_date', name: 'Agreement Date', dataType: 'date', importKeys: ['agreementDate'] },
  { key: 'actual_submission_date', name: 'Actual Bid Submission Date', dataType: 'date' },
  { key: 'crm_link', name: 'CRM Link', dataType: 'url', importKeys: ['crmUrl'] },
  /** A Google Drive folder: the grid lists its files (TenderFolderCell). */
  { key: 'tender_folder', name: 'Tender Folder Link', dataType: 'url', importKeys: ['tenderFolderUrl'] },
]
export const bidSystemField = (key: string) => BID_SYSTEM_FIELDS.find(f => f.key === key)

/** Live option lists for each source, supplied by the repository (DB or in-memory store). */
export interface BidOptionLookups {
  masters: Partial<Record<BidTrackerMasterKey, { name: string; description?: string | null }[]>>
  competitors: string[]
  preSales: string[]
}
/** Options (and tooltip hints) of a built-in field, or undefined for an ordinary custom field. */
export function resolveSystemOptions(fieldKey: string, lookups: BidOptionLookups): { options: string[]; hints: Record<string, string> } | undefined {
  const source = bidSystemField(fieldKey)?.source
  if (!source) return undefined
  if (source.kind === 'fixed') return { options: [...source.options], hints: {} }
  if (source.kind === 'competitors') return { options: [...lookups.competitors], hints: {} }
  if (source.kind === 'team') return { options: [...lookups.preSales], hints: {} }
  const rows = lookups.masters[source.masterKey] ?? []
  return {
    options: rows.map(r => r.name),
    hints: Object.fromEntries(rows.filter(r => r.description && r.description !== r.name).map(r => [r.name, String(r.description)])),
  }
}
/** Applies live options to field rows (ordinary custom fields are returned unchanged). */
export function withSystemOptions<T extends { key: string; options?: string[] | null }>(fields: T[], lookups: BidOptionLookups): (T & { optionHints?: Record<string, string> })[] {
  return fields.map(f => {
    const live = resolveSystemOptions(f.key, lookups)
    return live ? { ...f, options: live.options, optionHints: live.hints } : f
  })
}
/** The custom field (if any) that stores this master's values — for in-use checks and rename cascades. */
export const fieldsUsingMaster = (masterKey: string) =>
  BID_SYSTEM_FIELDS.filter(f => f.source?.kind === 'master' && f.source.masterKey === masterKey)

/** Indian financial-year quarter of an ISO date: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. */
export function financialQuarter(iso: string): 'Q1' | 'Q2' | 'Q3' | 'Q4' | null {
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(iso)
  if (!m) return null
  const month = Number(m[1])
  if (month < 1 || month > 12) return null
  return month >= 4 && month <= 6 ? 'Q1' : month >= 7 && month <= 9 ? 'Q2' : month >= 10 ? 'Q3' : 'Q4'
}
/** "2026-10-15" → "15/10/2026 (Q3)"; a missing or unreadable date shows no quarter. */
export function formatDateWithQuarter(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const q = financialQuarter(iso)
  return m && q ? `${m[3]}/${m[2]}/${m[1]} (${q})` : iso
}
/** Grid columns whose date also shows its financial quarter (no separate quarter columns). */
export const QUARTER_DATE_COLUMNS: ReadonlySet<string> = new Set(['general:publishingDate', 'general:receivingDate', 'custom:actual_submission_date'])

/** Bid Tracker fields kept in step with a Timeline phase's milestone (bid_milestones.key = phase key).
 *  flag: Yes ⇄ phase done (setting Yes marks it done today); No/blank reopens it.
 *  date: a date ⇄ phase done on that date; clearing the date reopens it. */
export const BID_TIMELINE_SYNC = [
  { field: 'pre_cxo', milestoneKey: 'qualification', label: 'Opportunity Go / No-Go', kind: 'flag' },
  { field: 'final_cxo', milestoneKey: 'presales:priceGoNoGo', label: 'Price Go / No-Go', kind: 'flag' },
  { field: 'loa_date', milestoneKey: 'sales:workOrderReceived', label: 'Work Order Received', kind: 'date' },
] as const
export type BidTimelineSync = (typeof BID_TIMELINE_SYNC)[number]
export const timelineSyncForField = (fieldKey: string): BidTimelineSync | undefined => BID_TIMELINE_SYNC.find(s => s.field === fieldKey)
export const timelineSyncForMilestone = (milestoneKey: string): BidTimelineSync | undefined => BID_TIMELINE_SYNC.find(s => s.milestoneKey === milestoneKey)
/** Milestone state a field value implies. `currentDue` is kept for a flag so a planned date is not lost. */
export function milestoneStateForField(sync: BidTimelineSync, value: unknown, today: string, currentDue: string | null): { status: 'open' | 'completed'; dueAt: string | null } {
  const v = value == null ? '' : String(value).trim()
  if (sync.kind === 'flag') return v === 'Yes' ? { status: 'completed', dueAt: currentDue ?? today } : { status: 'open', dueAt: currentDue }
  return v ? { status: 'completed', dueAt: v.slice(0, 10) } : { status: 'open', dueAt: currentDue }
}
/** Field value a milestone implies (null clears the field). */
export function fieldValueForMilestone(sync: BidTimelineSync, status: string, dueAt: string | null): string | null {
  if (sync.kind === 'flag') return status === 'completed' ? 'Yes' : 'No'
  return status === 'completed' && dueAt ? String(dueAt).slice(0, 10) : null
}

// Bid Tracker's Activity History, as people read it. The audit log stores
// database facts (`emdAmount`, `custom_value_set`, `frozen`); this turns each row
// — and each ownership assignment — into "what happened, who, when, which bid,
// which field, old → new". It is a view over the audit data: nothing here writes
// or reshapes it.
import { BID_STAGES, parseMultiValue, type CustomFieldType } from '@goms/domain'
import type { BidCustomField, OwnershipAssignment, SalesPerson } from '@/lib/types'
import type { CommercialAuditLog } from '@/modules/commercial-calculator/types'
import { DECISION_OPTIONS, formatCurrency, optionsOf, type EntityLookups } from './gridColumns'

export type ActivityKind = 'edit' | 'stage' | 'decision' | 'verify' | 'ownership' | 'protect' | 'corrigendum' | 'column'

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  edit: 'Field edits', stage: 'Stage changes', decision: 'Decisions', verify: 'Verification', ownership: 'Ownership',
  protect: 'Protected values', corrigendum: 'Corrigenda', column: 'Columns & views',
}

export interface ActivityChange { label: string; from: string | null; to: string | null }

export interface ActivityItem {
  id: string
  /** ISO timestamp (or bare date, for ownership). */
  at: string
  by: string | null
  byName: string
  kind: ActivityKind
  title: string
  changes: ActivityChange[]
  note?: string
  /** null = not about one bid (a column or view change). */
  bidId: string | null
  /** Housekeeping (a saved view's filters being tweaked) — hidden unless asked for. */
  minor?: boolean
}

export interface FeedContext {
  customFields: BidCustomField[]
  lookups: EntityLookups
  people: SalesPerson[]
  /** corrigendum id → bid id, for the audit rows keyed to a corrigendum. */
  corrigendumBid: Map<string, string>
}

/** Audit entity types Bid Tracker writes; `bid` and `bidCustomFieldValue` rows are keyed to a bid id. */
export const BID_ENTITY_TYPES = ['bid', 'bidMilestone', 'bidCorrigendum', 'bidSavedView', 'bidCustomField', 'bidCustomFieldValue']

const FIELD_LABEL: Record<string, string> = {
  stageKey: 'Bid Stage', decision: 'Decision', tenderLink: 'Tender Link', dataConfidence: 'Data Confidence',
  opportunityName: 'Opportunity / Mission', city: 'City', vertical: 'Sector', emdAmount: 'EMD Amount', valueAmount: 'Value',
  submissionDate: 'Submission Deadline', submissionDeadline: 'Submission Deadline', gemTenderId: 'Tender ID',
  departmentId: 'Department', status: 'Status', nextActionNote: 'Next Action',
}
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', solutionLead: 'Solution Lead' }

/** `emdAmount` / `client_contact` → "Emd Amount" / "Client Contact" (only for fields with no better name). */
export function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase())
}
export const fieldLabel = (key: string) => FIELD_LABEL[key] ?? humanize(key)

/** "rajas.saji@amnex.com" → their Sales Team name if they have one, else "Rajas Saji". */
export function personName(email: string | null, people: SalesPerson[]): string {
  if (!email) return 'System'
  const known = people.find((p) => p.officialEmail.toLowerCase() === email.toLowerCase())
  return known?.name ?? humanize(email.split('@')[0].replace(/[.]/g, ' '))
}

/** `2026-10-01` or a full ISO timestamp → "01 Oct 2026". */
export function formatDay(value: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** "01 Oct 2026, 12:14" */
export function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${formatDay(iso)}${/^\d{4}-\d{2}-\d{2}$/.test(iso) ? '' : `, ${time}`}`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

/** One audit value as a person would write it. Empty → null (rendered "—"). */
export function formatAuditValue(raw: string, type: CustomFieldType | null, field: string, col: BidCustomField | undefined, ctx: FeedContext): string | null {
  if (raw === '' || raw === null || raw === undefined) return null
  if (field === 'stageKey') return BID_STAGES.find((s) => s.key === raw)?.label ?? humanize(raw)
  if (field === 'decision') return DECISION_OPTIONS.find((o) => o.value === raw)?.label ?? humanize(raw)
  if (field === 'dataConfidence') return raw === 'verified' ? 'Verified' : raw === 'needs_review' ? 'Needs Review' : humanize(raw)
  switch (type) {
    case 'currency': return Number.isFinite(Number(raw)) ? formatCurrency(Number(raw)) : raw
    case 'boolean': return raw === 'true' ? 'Yes' : raw === 'false' ? 'No' : raw
    case 'date': return ISO_DATE.test(raw) ? formatDay(raw.slice(0, 10)) : raw
    case 'multiselect': return parseMultiValue(raw).join(', ') || null
    case 'person': case 'department': case 'state':
      // New entries already hold the record's NAME; older ones hold its id/code.
      return optionsOf({ type, options: col?.options?.map((o) => ({ value: o, label: o })) }, ctx.lookups).find((o) => o.value === raw)?.label ?? raw
    default: break
  }
  if (!type && /^(submissionDate|nextActionDueDate|submissionDeadline)$/.test(field) && ISO_DATE.test(raw)) return formatDay(raw.slice(0, 10))
  return raw
}

function customColumn(key: string, ctx: FeedContext) {
  return ctx.customFields.find((f) => f.key === key)
}

function fromAuditLog(log: CommercialAuditLog, ctx: FeedContext): ActivityItem | null {
  const base = { id: `audit:${log.id}`, at: log.changedAt, by: log.changedBy, byName: personName(log.changedBy, ctx.people) }
  const bidKeyed = log.entityType === 'bid' || log.entityType === 'bidCustomFieldValue'
  const bidId = bidKeyed ? log.entityId : log.entityType === 'bidCorrigendum' ? ctx.corrigendumBid.get(log.entityId) ?? null : null
  const change = (label: string, type: CustomFieldType | null, col?: BidCustomField): ActivityChange => ({
    label,
    from: formatAuditValue(log.oldValue, type, log.field, col, ctx),
    to: formatAuditValue(log.newValue, type, log.field, col, ctx),
  })
  /** "City changed" / "City set" / "City cleared", by what the old and new value are. */
  const verbFor = (label: string, c: ActivityChange) => (c.from === null && c.to !== null ? `${label} set` : c.to === null && c.from !== null ? `${label} cleared` : `${label} changed`)

  switch (log.entityType) {
    case 'bid': {
      if (log.action === 'mark_verified') return { ...base, kind: 'verify', title: 'Bid verified', changes: [], bidId }
      const label = fieldLabel(log.field)
      if (log.action === 'freeze') return { ...base, kind: 'protect', title: `${label} protected`, changes: [], note: 'Frozen against direct edits', bidId }
      if (log.action === 'unfreeze') return { ...base, kind: 'protect', title: `${label} unprotected`, changes: [], note: log.reason ? `Reason: ${log.reason}` : undefined, bidId }
      const c = change(label, null)
      const kind: ActivityKind = log.field === 'stageKey' ? 'stage' : log.field === 'decision' ? 'decision' : 'edit'
      const title = kind === 'stage' ? 'Stage changed' : kind === 'decision' ? 'Decision recorded' : verbFor(label, c)
      return { ...base, kind, title, changes: [c], note: log.reason || undefined, bidId }
    }
    case 'bidCustomFieldValue': {
      const col = customColumn(log.field, ctx)
      const label = col?.name ?? humanize(log.field)
      const c = change(label, col?.dataType ?? null, col)
      return { ...base, kind: 'edit', title: verbFor(label, c), changes: [c], note: log.reason || undefined, bidId }
    }
    case 'bidCorrigendum': {
      const label = fieldLabel(log.field)
      const accepted = log.action === 'corrigendum_accepted'
      return {
        ...base, kind: 'corrigendum', title: `Corrigendum ${accepted ? 'accepted' : 'rejected'}: ${label}`,
        changes: [change(label, null)], note: log.reason || undefined, bidId,
      }
    }
    case 'bidCustomField': {
      const name = log.field === 'name' ? (log.newValue || log.oldValue) : ''
      const titles: Record<string, string> = {
        custom_field_created: `Column “${log.newValue}” added`,
        custom_field_renamed: 'Column renamed',
        custom_field_archived: 'Column archived',
        custom_field_unarchived: 'Column restored',
        custom_field_deleted: `Column “${name}” deleted`,
        custom_field_reordered: 'Column reordered',
        custom_field_options_changed: 'Column options changed',
      }
      const title = titles[log.action] ?? humanize(log.action)
      const changes = log.action === 'custom_field_renamed' ? [{ label: 'Name', from: log.oldValue || null, to: log.newValue || null }] : []
      return { ...base, kind: 'column', title, changes, note: log.reason || undefined, bidId: null }
    }
    case 'bidSavedView': {
      if (log.action === 'create') return { ...base, kind: 'column', title: `Saved view “${log.newValue}” created`, changes: [], bidId: null }
      if (log.action === 'delete') return { ...base, kind: 'column', title: 'Saved view deleted', changes: [], bidId: null }
      return { ...base, kind: 'column', title: 'Saved view updated', changes: [], bidId: null, minor: true }
    }
    default:
      return null
  }
}

function fromOwnership(a: OwnershipAssignment, ctx: FeedContext): ActivityItem {
  const who = ctx.people.find((p) => p.id === a.salesPersonId)?.name ?? 'a sales person'
  const role = ROLE_LABEL[a.role] ?? humanize(a.role)
  const span = a.endDate ? `${formatDay(a.startDate)} to ${formatDay(a.endDate)}` : `from ${formatDay(a.startDate)}`
  return {
    id: `ownership:${a.id}`, at: a.createdAt, by: a.createdBy, byName: personName(a.createdBy, ctx.people),
    kind: 'ownership', title: `${role} assigned: ${who}`, changes: [], note: span, bidId: a.entityId,
  }
}

/** Audit rows and ownership assignments → one newest-first list. */
export function buildActivityItems(logs: CommercialAuditLog[], assignments: OwnershipAssignment[], ctx: FeedContext): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const log of logs) {
    if (!BID_ENTITY_TYPES.includes(log.entityType)) continue
    const item = fromAuditLog(log, ctx)
    if (item) items.push(item)
  }
  for (const a of assignments) if (a.entityType === 'bid') items.push(fromOwnership(a, ctx))
  // Parsed, not string-compared: ownership rows can carry a bare date while audit rows carry a full timestamp.
  return items.sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
}

export interface ActivityGroup { id: string; at: string; byName: string; bidId: string | null; items: ActivityItem[] }

const GROUPABLE: ReadonlySet<ActivityKind> = new Set(['edit', 'stage', 'decision'])
const GROUP_WINDOW_MS = 90_000

/** Consecutive edits by one person to one bid within a minute and a half read as
 *  one entry ("Shubham made 3 changes") instead of three. Input is newest-first. */
export function groupActivity(items: ActivityItem[]): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    const prev = last?.items[last.items.length - 1]
    const joins = !!last && !!prev && GROUPABLE.has(item.kind) && GROUPABLE.has(prev.kind)
      && item.bidId !== null && item.bidId === last.bidId && item.by === prev.by
      && Math.abs(Date.parse(prev.at) - Date.parse(item.at)) <= GROUP_WINDOW_MS
      // Changing the same field again is its own entry, not a second line of one.
      && !last.items.some((it) => it.changes[0]?.label !== undefined && it.changes[0].label === item.changes[0]?.label)
    if (joins) last.items.push(item)
    else groups.push({ id: item.id, at: item.at, byName: item.byName, bidId: item.bidId, items: [item] })
  }
  return groups
}

export interface ActivityFilters {
  query: string
  bidId: string
  by: string
  kind: ActivityKind | ''
  /** Inclusive `YYYY-MM-DD`, in the viewer's local time. */
  from: string
  to: string
}
export const NO_ACTIVITY_FILTERS: ActivityFilters = { query: '', bidId: '', by: '', kind: '', from: '', to: '' }

const localDay = (iso: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function filterActivity(
  items: ActivityItem[], f: ActivityFilters, bidLabel: (bidId: string) => string,
): ActivityItem[] {
  const q = f.query.trim().toLowerCase()
  return items.filter((i) => {
    // Housekeeping stays out of the way unless that category is chosen.
    if (i.minor && f.kind !== 'column') return false
    if (f.bidId && i.bidId !== f.bidId) return false
    if (f.by && (i.by ?? '') !== f.by) return false
    if (f.kind && i.kind !== f.kind) return false
    if (f.from && localDay(i.at) < f.from) return false
    if (f.to && localDay(i.at) > f.to) return false
    if (!q) return true
    const hay = [i.title, i.byName, i.note ?? '', i.bidId ? bidLabel(i.bidId) : '', ...i.changes.flatMap((c) => [c.label, c.from ?? '', c.to ?? ''])]
    return hay.join(' ').toLowerCase().includes(q)
  })
}


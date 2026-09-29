// Bid Tracker's own stage machine — deliberately separate from
// opportunities.ts's PIPELINE_STAGES (spec §4.4). Data, not a TypeScript
// union, same reasoning as PIPELINE_STAGES: a retired stage must keep
// rendering on historical rows.
export interface BidStageDef {
  key: string
  label: string
  order: number
  closed: boolean
}

export const BID_STAGES: BidStageDef[] = [
  { key: 'solutioning', label: 'Solutioning', order: 0, closed: false },
  { key: 'qualification', label: 'Qualification', order: 1, closed: false },
  { key: 'preBidQueries', label: 'Pre-bid Queries', order: 2, closed: false },
  { key: 'commercialProposal', label: 'Commercial Proposal', order: 3, closed: false },
  { key: 'submitted', label: 'Submitted', order: 4, closed: false },
  { key: 'goApproved', label: 'Go Approved', order: 5, closed: true },
  { key: 'dropped', label: 'Dropped', order: 6, closed: true },
]

export const BID_STAGE_MAP: Record<string, BidStageDef> = Object.fromEntries(BID_STAGES.map((s) => [s.key, s]))
export const DEFAULT_BID_STAGE_KEY = 'solutioning'

/** -1 for an unknown key, so a stale/retired stage never compares as
 *  "at or after" anything by accident. */
export function bidStageOrder(key: string): number {
  return BID_STAGE_MAP[key]?.order ?? -1
}

/** Gate for `decision='go'` (spec §4.4's tightening) — a Go decision cannot
 *  be recorded before the bid has actually reached Submitted. */
export function isAtOrAfterSubmitted(key: string): boolean {
  return bidStageOrder(key) >= bidStageOrder('submitted')
}

/** "Next Stage Requirements" banner — derived, not persisted (spec §10).
 *  Keyed by the CURRENT stage: what's needed to move past it. */
export const BID_STAGE_REQUIREMENTS: Record<string, string[]> = {
  solutioning: ['Technical solution finalized', 'Pre-bid queries submitted'],
  qualification: ['Executive Go / No-Go sign-off'],
  preBidQueries: ['Pre-bid query responses received'],
  commercialProposal: ['Commercial proposal finalized', 'EMD/tender fee arranged'],
  submitted: ['Await tender opening / evaluation'],
  goApproved: [],
  dropped: [],
}

export function formatBidCode(year: number | string, seq: number): string {
  return `BID-${year}-${String(seq).padStart(4, '0')}`
}

export interface SystemBidViewFilterRule {
  field: string
  operator: 'eq'
  value: string
}
export interface SystemBidView {
  key: string
  name: string
  filterRules: SystemBidViewFilterRule[]
}

// Permanent system views (spec §9.1) — generic to any Bid Tracker
// deployment. "$currentUser" is resolved server-side to ctx.user.email at
// query time (Task 19); it is never a literal stored email. These are the
// ONLY seeded/initial views — "Smart Transport Bids" and "High Value Deals
// > 20 Cr" from the reference screenshots are illustrative examples of what
// a user creates later and must never appear here.
export const SYSTEM_BID_VIEWS: SystemBidView[] = [
  { key: 'allBids', name: 'All Bids', filterRules: [] },
  { key: 'myBids', name: 'My Bids', filterRules: [{ field: 'ownerEmail', operator: 'eq', value: '$currentUser' }] },
  { key: 'solutioning', name: 'Solutioning', filterRules: [{ field: 'stageKey', operator: 'eq', value: 'solutioning' }] },
  { key: 'qualification', name: 'Qualification', filterRules: [{ field: 'stageKey', operator: 'eq', value: 'qualification' }] },
  { key: 'dueSoon', name: 'Due Soon', filterRules: [{ field: 'attentionFlag', operator: 'eq', value: 'dueSoon' }] },
  { key: 'overdue', name: 'Overdue', filterRules: [{ field: 'attentionFlag', operator: 'eq', value: 'overdue' }] },
  { key: 'goApproved', name: 'Go Approved', filterRules: [{ field: 'stageKey', operator: 'eq', value: 'goApproved' }] },
]
export const SYSTEM_BID_VIEW_KEYS = new Set(SYSTEM_BID_VIEWS.map((v) => v.key))

export type BidAttentionFlag = 'dueSoon' | 'overdue' | 'corrigendumPending' | 'onTrack'

/** Spec §15 — computed at query time, never stored. Corrigendum-pending
 *  takes precedence over the date-based flags. */
export function computeAttentionFlag(input: {
  dueAt: string | null
  hasPendingCorrigendum: boolean
  today: string
  dueSoonDays?: number
}): BidAttentionFlag {
  if (input.hasPendingCorrigendum) return 'corrigendumPending'
  if (!input.dueAt) return 'onTrack'
  const dueDate = input.dueAt.slice(0, 10)
  if (dueDate < input.today) return 'overdue'
  const dueSoonDays = input.dueSoonDays ?? 3
  const threshold = new Date(input.today)
  threshold.setDate(threshold.getDate() + dueSoonDays)
  if (dueDate <= threshold.toISOString().slice(0, 10)) return 'dueSoon'
  return 'onTrack'
}

/** Resolves the one supported placeholder token. Anything else passes
 *  through unchanged. Deterministic even with no signed-in user (spec's
 *  Review Focus: AUTH_ENFORCEMENT_ENABLED is off by default across this
 *  codebase) — resolves to null, which then matches nothing rather than
 *  throwing, so "My Bids" with no signed-in user is simply an empty list,
 *  not a crash. */
export function resolveFilterValue(value: string, currentUserEmail: string | null): string | null {
  return value === '$currentUser' ? currentUserEmail : value
}

export function applyFilterRules<T extends Record<string, unknown>>(
  rows: T[],
  rules: SystemBidViewFilterRule[],
  currentUserEmail: string | null,
): T[] {
  if (!rules.length) return rows
  return rows.filter((row) => rules.every((rule) => {
    const target = resolveFilterValue(rule.value, currentUserEmail)
    // A token that resolves to "no value" (e.g. $currentUser with no
    // signed-in user) must never match, even a row whose own field is also
    // null/undefined — otherwise "My Bids" with no signed-in user would
    // wrongly surface every bid that happens to have no owner assigned.
    if (target === null) return false
    return row[rule.field] === target
  }))
}

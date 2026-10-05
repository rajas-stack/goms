// The Opportunity Dashboard's numbers — pure, so every count is unit-tested and
// the page only lays them out. Definitions (over NON-archived grid rows):
//   Live bids = rows in Bid Tracker whose bid stage is not a closed one.
//   Pipeline  = rows in Pipeline · Funnel / Backup / Commits (with the three sub-counts).
//   Campaign  = rows in Campaign.
import { BID_STAGE_MAP, type OwnedSheet } from '@goms/domain'
import type { BidGridRow } from '@/lib/types'

/** The rows the dashboard reads — only what it needs, so tests can build them small. */
export type DashboardRow = Pick<BidGridRow, 'sheet' | 'stageKey' | 'status' | 'vertical' | 'attentionFlag'>

export type DashboardMeasure = 'live' | 'pipeline' | 'campaign'

/** The URL / select value for rows with no vertical. */
export const UNASSIGNED_VERTICAL = 'unassigned'
export const UNASSIGNED_LABEL = 'Unassigned'

export interface DashboardCounts {
  live: number
  /** Live bids flagged Due Soon / Overdue. */
  liveDueSoon: number
  liveOverdue: number
  pipeline: number
  funnel: number
  backup: number
  commits: number
  campaign: number
}

export interface VerticalBreakdown {
  /** A vertical's name, or UNASSIGNED_VERTICAL. */
  value: string
  label: string
  live: number
  pipeline: number
  campaign: number
}

export interface DashboardData {
  counts: DashboardCounts
  /** Every vertical with something in it (plus the selected one), largest first; Unassigned last. */
  byVertical: VerticalBreakdown[]
  /** Non-archived rows behind the counts (after the vertical filter). */
  matched: number
}

const PIPELINE_SHEETS: Record<string, keyof Pick<DashboardCounts, 'funnel' | 'backup' | 'commits'>> = {
  'pipeline-funnel': 'funnel', 'pipeline-backup': 'backup', 'pipeline-commits': 'commits',
}

/** The vertical a row is grouped under: its trimmed name, or UNASSIGNED_VERTICAL when blank. */
export function verticalOf(row: Pick<DashboardRow, 'vertical'>): string {
  return row.vertical?.trim() || UNASSIGNED_VERTICAL
}

export function verticalLabel(value: string): string {
  return value === UNASSIGNED_VERTICAL ? UNASSIGNED_LABEL : value
}

export function isLiveBid(row: Pick<DashboardRow, 'sheet' | 'stageKey'>): boolean {
  return (row.sheet ?? 'bidTracker') === 'bidTracker' && BID_STAGE_MAP[row.stageKey]?.closed !== true
}

/** Which headline measure a row counts toward (null = none: a closed bid). */
export function measureOf(row: Pick<DashboardRow, 'sheet' | 'stageKey'>): DashboardMeasure | null {
  const sheet: OwnedSheet = row.sheet ?? 'bidTracker'
  if (sheet === 'bidTracker') return isLiveBid(row) ? 'live' : null
  if (sheet === 'campaign') return 'campaign'
  return 'pipeline'
}

const emptyCounts = (): DashboardCounts => ({ live: 0, liveDueSoon: 0, liveOverdue: 0, pipeline: 0, funnel: 0, backup: 0, commits: 0, campaign: 0 })

export function countRows(rows: DashboardRow[]): DashboardCounts {
  const counts = emptyCounts()
  for (const row of rows) {
    if (row.status === 'archived') continue
    const measure = measureOf(row)
    if (!measure) continue
    counts[measure] += 1
    if (measure === 'live') {
      if (row.attentionFlag === 'dueSoon') counts.liveDueSoon += 1
      if (row.attentionFlag === 'overdue') counts.liveOverdue += 1
    }
    if (measure === 'pipeline') {
      const sub = PIPELINE_SHEETS[row.sheet]
      if (sub) counts[sub] += 1
    }
  }
  return counts
}

/** The filter's choices: the app's verticals (in their usual order), then any other
 *  vertical found in the rows (sorted), then Unassigned when some row has none. */
export function verticalOptions(rows: DashboardRow[], known: readonly string[]): { value: string; label: string }[] {
  const knownSet = new Set(known)
  const extra = new Set<string>()
  let hasBlank = false
  for (const row of rows) {
    if (row.status === 'archived') continue
    const v = verticalOf(row)
    if (v === UNASSIGNED_VERTICAL) hasBlank = true
    else if (!knownSet.has(v)) extra.add(v)
  }
  const values = [...known, ...[...extra].sort((a, b) => a.localeCompare(b))]
  if (hasBlank) values.push(UNASSIGNED_VERTICAL)
  return values.map((value) => ({ value, label: verticalLabel(value) }))
}

/** Headline counts for `vertical` (null = all verticals) plus the per-vertical
 *  breakdown, which always covers every vertical so the selected one can be
 *  seen against the rest. */
export function computeDashboard(rows: DashboardRow[], vertical: string | null): DashboardData {
  const active = rows.filter((r) => r.status !== 'archived')
  const matching = vertical ? active.filter((r) => verticalOf(r) === vertical) : active
  const groups = new Map<string, VerticalBreakdown>()
  const groupFor = (value: string) => {
    let g = groups.get(value)
    if (!g) { g = { value, label: verticalLabel(value), live: 0, pipeline: 0, campaign: 0 }; groups.set(value, g) }
    return g
  }
  for (const row of active) {
    const measure = measureOf(row)
    if (measure) groupFor(verticalOf(row))[measure] += 1
  }
  if (vertical) groupFor(vertical)
  const total = (g: VerticalBreakdown) => g.live + g.pipeline + g.campaign
  const byVertical = [...groups.values()].sort((a, b) =>
    Number(a.value === UNASSIGNED_VERTICAL) - Number(b.value === UNASSIGNED_VERTICAL)
    || total(b) - total(a)
    || a.label.localeCompare(b.label))
  const counts = countRows(matching)
  return { counts, byVertical, matched: counts.live + counts.pipeline + counts.campaign }
}

// The Opportunity module is a set of sheets, each the same Excel-style grid, each
// with its OWN saved views (system views appear on every sheet). Every bid lives in
// exactly ONE sheet (`Bid.sheet`); Master is the collective list of all of them.
import { OWNED_SHEETS, OWNED_SHEET_LABELS, type OwnedSheet } from '@goms/domain'

export type SheetId = OwnedSheet | 'master'
export { OWNED_SHEETS, OWNED_SHEET_LABELS, type OwnedSheet }

/** Does a row living in `rowSheet` show on `sheet`? Master shows every row. */
export function rowInSheet(rowSheet: OwnedSheet | undefined, sheet: SheetId): boolean {
  return sheet === 'master' || (rowSheet ?? 'bidTracker') === sheet
}

/** The toolbar's create button, worded for the sheet it files into. */
export function createLabelFor(sheet: SheetId): string {
  if (sheet === 'bidTracker') return 'Create Bid'
  if (sheet === 'campaign') return 'Add to Campaign'
  if (sheet === 'master') return 'Create'
  return 'Add to Pipeline'
}

export const PIPELINE_TABS = [
  { value: 'funnel', label: 'Funnel', sheet: 'pipeline-funnel' as const },
  { value: 'backup', label: 'Backup', sheet: 'pipeline-backup' as const },
  { value: 'commits', label: 'Commits', sheet: 'pipeline-commits' as const },
] as const
export type PipelineTab = (typeof PIPELINE_TABS)[number]['value']

/** Top-level Opportunity tabs, in order. */
export const OPPORTUNITY_TABS = [
  { value: 'bid-tracker', label: 'Bid Tracker', icon: 'Flag', path: '/bid-tracker' },
  { value: 'pipeline', label: 'Pipeline', icon: 'TrendingUp', path: '/bid-tracker/pipeline/funnel' },
  { value: 'campaign', label: 'Campaign', icon: 'Send', path: '/bid-tracker/campaign' },
  { value: 'master', label: 'Master', icon: 'Database', path: '/bid-tracker/master' },
  { value: 'dashboard', label: 'Dashboard', icon: 'BarChart3', path: '/bid-tracker/dashboard' },
] as const
export type OpportunityTab = (typeof OPPORTUNITY_TABS)[number]['value']

import type { ColumnOwner } from '@/lib/types'

/** Which custom columns a sheet owns. Pipeline's Funnel / Backup / Commits share one set. */
export function columnOwner(sheet: SheetId): ColumnOwner {
  if (sheet === 'bidTracker' || sheet === 'campaign' || sheet === 'master') return sheet
  return 'pipeline'
}

/** What the Master sheet's switcher can narrow its columns to. */
export type MasterScope = 'all' | 'bidTracker' | 'pipeline' | 'campaign'
export const MASTER_SCOPES: { value: MasterScope; label: string }[] = [
  { value: 'all', label: 'All sheets' },
  { value: 'bidTracker', label: 'Bid Tracker' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'campaign', label: 'Campaign' },
]

/** Does a custom column of owner `owner` show on `sheet` (Master, narrowed to `scope`)? */
export function columnInScope(owner: ColumnOwner | undefined, sheet: SheetId, scope: MasterScope = 'all'): boolean {
  const o = owner ?? 'bidTracker'
  if (sheet !== 'master') return o === columnOwner(sheet)
  return scope === 'all' || o === scope
}

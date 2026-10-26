import { isOwnedSheet, type OwnedSheet } from '@goms/domain'
import { calendarDay } from './timelineDates'
import type { IsoDate, OpportunityLifecycleStage } from './types'
import { stageIntervals, type StageChange } from './bidTimelineAdapter'

export interface LifecycleInput {
  createdAt: IsoDate
  bidCreatedAt: IsoDate
  sheet?: OwnedSheet
  sheetChanges?: StageChange[]
}

function lifecycleGroup(sheet: string): OpportunityLifecycleStage['name'] | null {
  if (!isOwnedSheet(sheet)) return null
  return sheet === 'campaign' ? 'Campaign' : sheet === 'bidTracker' ? 'Live Bids' : 'Pipeline'
}

/** Replays sheet moves on the original record, including moves back to an earlier sheet. */
export function opportunityLifecycle(input: LifecycleInput): OpportunityLifecycleStage[] {
  const changes = (input.sheetChanges ?? []).filter(change => isOwnedSheet(change.oldValue) && isOwnedSheet(change.newValue))
  const firstSheet = [...changes].sort((a, b) => a.changedAt.localeCompare(b.changedAt))[0]?.oldValue ?? input.sheet ?? 'bidTracker'
  const start = calendarDay(firstSheet === 'campaign' ? input.createdAt : input.bidCreatedAt) ?? input.createdAt
  const visits = stageIntervals(firstSheet, start, changes)
  return (['Campaign', 'Pipeline', 'Live Bids'] as const).map((name) => {
    const intervals = [...visits].filter(([sheet]) => lifecycleGroup(sheet) === name).flatMap(([, dates]) => dates)
      .sort((a, b) => a.enter.localeCompare(b.enter))
    const first = intervals[0]
    const last = intervals[intervals.length - 1]
    const open = intervals.some(visit => !visit.exit)
    return {
      id: `lifecycle:${name}`, name,
      status: first ? open ? 'IN_PROGRESS' : 'COMPLETED' : 'UPCOMING',
      ...(first ? { actualStart: first.enter } : {}),
      ...(last?.exit && !open ? { actualEnd: last.exit } : {}),
    }
  })
}

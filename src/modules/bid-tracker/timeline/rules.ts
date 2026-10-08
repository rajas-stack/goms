// Rule-based planned lifecycle. A plan is never stored or hardcoded: it is
// derived from the opportunity's start and end dates plus a percentage weight
// per phase, so a 30-, 60- or 180-day opportunity compresses proportionally.
import { addDays, diffDays, toDay } from './timelineDates'
import type { IsoDate } from './types'

export interface PhaseRule {
  key: string
  name: string
  /** Relative share of the available days (need not sum to 100). */
  weight: number
  icon?: string
}

export interface PlannedPhase {
  key: string
  name: string
  sequence: number
  plannedStart: IsoDate
  plannedEnd: IsoDate
  icon?: string
}

/** Default weights for the open bid stages (BID_STAGES order). Submission is a
 *  short final window before the deadline. */
export const BID_PHASE_RULES: readonly PhaseRule[] = [
  { key: 'solutioning', name: 'Solutioning', weight: 30, icon: 'Lightbulb' },
  { key: 'qualification', name: 'Qualification', weight: 15, icon: 'ClipboardCheck' },
  { key: 'preBidQueries', name: 'Pre-bid Queries', weight: 20, icon: 'MessageSquareText' },
  { key: 'commercialProposal', name: 'Commercial Proposal', weight: 30, icon: 'FileText' },
  { key: 'submitted', name: 'Submitted', weight: 5, icon: 'Flag' },
]

/** Default span used when an opportunity has no usable deadline. */
export const FALLBACK_DURATION_DAYS = 60

/**
 * Splits [start, end] into contiguous phases sized by weight. Boundaries are
 * shared (phase i ends on the day phase i+1 starts), so there are no gaps or
 * overlaps, and the last phase always ends exactly on `endDate`.
 */
export function generatePlannedPlan(startDate: IsoDate, endDate: IsoDate, rules: readonly PhaseRule[]): PlannedPhase[] {
  if (Number.isNaN(toDay(startDate)) || Number.isNaN(toDay(endDate))) throw new Error('Plan dates must be YYYY-MM-DD')
  if (toDay(endDate) < toDay(startDate)) throw new Error('Plan end date is before its start date')
  if (rules.length === 0) return []
  if (rules.some((r) => !(r.weight > 0))) throw new Error('Every phase weight must be positive')
  const totalWeight = rules.reduce((sum, r) => sum + r.weight, 0)
  const totalDays = diffDays(startDate, endDate)
  const boundaries = rules.reduce<number[]>((acc, rule) => {
    const cumulative = acc.length === 0 ? 0 : acc[acc.length - 1]
    return [...acc, cumulative + rule.weight]
  }, [])
  const offsetAt = (i: number) => (i === 0 ? 0 : Math.round((totalDays * boundaries[i - 1]) / totalWeight))
  return rules.map((rule, i) => ({
    key: rule.key,
    name: rule.name,
    sequence: i + 1,
    icon: rule.icon,
    plannedStart: addDays(startDate, offsetAt(i)),
    plannedEnd: i === rules.length - 1 ? endDate : addDays(startDate, offsetAt(i + 1)),
  }))
}

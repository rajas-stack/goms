// Opportunity Lifecycle Timeline — data model. The visual component only
// CONSUMES these: every date in here was computed upstream (planned dates by
// the rules module, actual dates from stage history), never hardcoded.
import type { AvatarPerson } from '@/components/ui/Avatar'

/** Calendar date, `YYYY-MM-DD`. All timeline math works in whole UTC days. */
export type IsoDate = string

export type MilestoneStatus = 'COMPLETED' | 'IN_PROGRESS' | 'UPCOMING' | 'DELAYED' | 'BLOCKED'

export interface Milestone {
  id: string
  name: string
  plannedStart: IsoDate
  plannedEnd: IsoDate
  actualStart?: IsoDate
  actualEnd?: IsoDate
  status: MilestoneStatus
  sequence: number
  /** Name from the shared Icon registry. */
  icon?: string
  issueCount?: number
}

export const TIMELINE_EVENT_TYPES = [
  'Issue', 'Delay', 'Dependency', 'Client Hold', 'Internal Hold', 'Submission Change',
  'Clarification', 'Query', 'Approval Pending', 'Scope Change',
] as const
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number]
export type TimelineEventSeverity = 'Low' | 'Medium' | 'High' | 'Critical'
export type TimelineEventStatus = 'Open' | 'Resolved'

export interface TimelineEvent {
  id: string
  milestoneId?: string
  date: IsoDate
  type: TimelineEventType
  severity: TimelineEventSeverity
  title: string
  description?: string
  /** Plain owner label (an email or free text when no person record exists). */
  owner?: string
  /** The owner's person record, when one exists — rendered with an avatar. */
  ownerPerson?: AvatarPerson
  status: TimelineEventStatus
}

export interface OpportunityTimeline {
  opportunityId: string
  startDate: IsoDate
  endDate: IsoDate
  milestones: Milestone[]
  events: TimelineEvent[]
  /** True when the end date is a rule-based fallback (no usable deadline on record). */
  endDateEstimated?: boolean
  /** Final outcome label once the opportunity is closed ("Go Approved", "Dropped"). */
  outcome?: string | null
  /** Most recent note on the opportunity, shown as the latest comment. */
  latestNote?: TimelineNote | null
}

export interface TimelineNote {
  text: string
  /** ISO timestamp. */
  at: string
  author?: string
  authorPerson?: AvatarPerson
}

// Bid → OpportunityTimeline. Pure: every input is passed in, so the mapping
// (stage history → actual dates, status, events) is unit-tested without a store.
// Planned dates come from the rules module; actual dates from the stage audit trail.
import { BID_STAGE_MAP, BID_STAGES } from '@goms/domain'
import type { AvatarPerson } from '@/components/ui/Avatar'
import type { BidCorrigendum, BidMilestone, FollowUp } from '@/lib/types'
import { BID_PHASE_RULES, FALLBACK_DURATION_DAYS, generatePlannedPlan, type PhaseRule, type PlannedPhase } from './rules'
import { addDays, calendarDay, diffDays, pluralDays, toDay } from './timelineDates'
import type { IsoDate, Milestone, MilestoneStatus, OpportunityTimeline, TimelineEvent, TimelineNote } from './types'

/** One `field === 'stageKey'` audit row for the bid. */
export interface StageChange { changedAt: string; oldValue: string; newValue: string }

export interface BidTimelineInput {
  bid: { id: string; opportunityId: string; stageKey: string; createdAt: string }
  /** The opportunity's submission deadline, as stored (date or timestamp). */
  submissionDate?: string | null
  stageChanges: StageChange[]
  corrigenda?: BidCorrigendum[]
  followUps?: FollowUp[]
  milestones?: BidMilestone[]
  /** Sales-team people, to show follow-up assignees with their avatar. */
  people?: (AvatarPerson & { id: string; officialEmail?: string | null })[]
  today: IsoDate
  /** Defaults to the open bid stages. */
  rules?: readonly PhaseRule[]
}

interface StageInterval { enter: IsoDate; exit?: IsoDate }

/** Orders changes that share a timestamp (bulk edits, same-second writes) by
 *  following the stage chain: each one leaves the stage the previous one entered. */
function chainOrder(group: StageChange[]): StageChange[] {
  if (group.length < 2) return group
  const entered = new Set(group.map((c) => c.newValue))
  const ordered: StageChange[] = []
  const rest = [...group]
  let next = rest.find((c) => !entered.has(c.oldValue)) ?? rest[0]
  while (next) {
    ordered.push(next)
    rest.splice(rest.indexOf(next), 1)
    const from = next.newValue
    next = rest.find((c) => c.oldValue === from) ?? rest[0]
  }
  return ordered
}

function orderChanges(changes: StageChange[]): StageChange[] {
  const byTime = [...changes].sort((a, b) => a.changedAt.localeCompare(b.changedAt))
  const groups: StageChange[][] = []
  for (const c of byTime) {
    const last = groups[groups.length - 1]
    if (last && last[0].changedAt === c.changedAt) last.push(c)
    else groups.push([c])
  }
  return groups.flatMap(chainOrder)
}

/** Each stage's visits, replaying the audit trail from creation. */
export function stageIntervals(initialStage: string, createdAt: IsoDate, changes: StageChange[]): Map<string, StageInterval[]> {
  const sorted = orderChanges(changes)
  const firstStage = sorted[0]?.oldValue || initialStage
  const visits = new Map<string, StageInterval[]>([[firstStage, [{ enter: createdAt }]]])
  for (const change of sorted) {
    const day = calendarDay(change.changedAt) ?? createdAt
    const fromVisits = visits.get(change.oldValue) ?? []
    const open = fromVisits[fromVisits.length - 1]
    if (open && !open.exit) visits.set(change.oldValue, [...fromVisits.slice(0, -1), { ...open, exit: day }])
    visits.set(change.newValue, [...(visits.get(change.newValue) ?? []), { enter: day }])
  }
  return visits
}

/** Resolves the end date: the deadline when usable, else start + fallback span (flagged). */
export function resolveEndDate(start: IsoDate, submissionDate?: string | null): { endDate: IsoDate; estimated: boolean } {
  const deadline = calendarDay(submissionDate ?? null)
  if (deadline && toDay(deadline) > toDay(start)) return { endDate: deadline, estimated: false }
  return { endDate: addDays(start, FALLBACK_DURATION_DAYS), estimated: true }
}

interface StatusContext { currentOrder: number; closed: boolean; today: IsoDate; terminalKey: string; reachedOrder: number }

function phaseStatus(phase: PlannedPhase, order: number, entered: boolean, ctx: StatusContext): MilestoneStatus {
  const isCurrent = order === ctx.currentOrder && !ctx.closed
  if (isCurrent && phase.key === ctx.terminalKey) return 'COMPLETED'
  if (isCurrent) return toDay(ctx.today) > toDay(phase.plannedEnd) ? 'DELAYED' : 'IN_PROGRESS'
  if (ctx.closed) return entered || order <= ctx.reachedOrder ? 'COMPLETED' : 'UPCOMING'
  if (order < ctx.currentOrder) return 'COMPLETED'
  return 'UPCOMING'
}

function buildMilestone(phase: PlannedPhase, visits: StageInterval[] | undefined, ctx: StatusContext): Milestone {
  const order = BID_STAGE_MAP[phase.key]?.order ?? phase.sequence - 1
  const entered = !!visits?.length
  const status = phaseStatus(phase, order, entered, ctx)
  const actualStart = visits?.[0]?.enter
  const lastExit = visits?.[visits.length - 1]?.exit
  const terminalReached = phase.key === ctx.terminalKey && entered
  const actualEnd = status === 'COMPLETED' ? (terminalReached ? actualStart : lastExit) : undefined
  return {
    id: phase.key, name: phase.name, sequence: phase.sequence, icon: phase.icon,
    plannedStart: phase.plannedStart, plannedEnd: phase.plannedEnd,
    status,
    ...(actualStart ? { actualStart } : {}),
    ...(actualEnd ? { actualEnd } : {}),
  }
}

/** The phase whose planned span holds `date` (last phase for anything after the end). */
export function milestoneForDate(milestones: Milestone[], date: IsoDate): string | undefined {
  const day = toDay(date)
  const hit = milestones.find((m) => day >= toDay(m.plannedStart) && day < toDay(m.plannedEnd))
  return (hit ?? (day < toDay(milestones[0]?.plannedStart ?? date) ? milestones[0] : milestones[milestones.length - 1]))?.id
}

function corrigendumEvents(corrigenda: BidCorrigendum[]): Omit<TimelineEvent, 'milestoneId'>[] {
  return corrigenda.flatMap((c) => {
    const date = calendarDay(c.detectedAt)
    if (!date) return []
    const changes = c.changes.map((ch) => `${ch.fieldKey}: ${ch.currentValue || '—'} → ${ch.proposedValue || '—'}`)
    return [{
      id: `corrigendum:${c.id}`, date, type: 'Submission Change' as const,
      severity: c.status === 'pending_review' ? 'High' as const : 'Medium' as const,
      title: `Corrigendum #${c.corrigendumNumber}`,
      description: changes.length ? changes.join('; ') : undefined,
      ...(c.reviewedBy ? { owner: c.reviewedBy } : {}),
      status: c.status === 'reviewed' ? 'Resolved' as const : 'Open' as const,
    }]
  })
}

const OVERDUE_HIGH_DAYS = 7

function followUpEvents(followUps: FollowUp[], people: BidTimelineInput['people'], today: IsoDate): Omit<TimelineEvent, 'milestoneId'>[] {
  return followUps.flatMap((f) => {
    const due = calendarDay(f.dueDate)
    if (f.status !== 'open' || !due || toDay(due) >= toDay(today)) return []
    const overdue = diffDays(due, today)
    const person = people?.find((p) => p.id === f.assigneeId)
    return [{
      id: `followUp:${f.id}`, date: due, type: 'Delay' as const,
      severity: overdue > OVERDUE_HIGH_DAYS ? 'High' as const : 'Medium' as const,
      title: `Overdue next action: ${f.note || 'follow-up'}`,
      description: `Due ${pluralDays(overdue)} ago and still open.`,
      ...(person ? { owner: person.name, ownerPerson: { name: person.name, photoUrl: person.photoUrl ?? null } } : {}),
      status: 'Open' as const,
    }]
  })
}

const QUERY_MILESTONE = /quer|clarif|pre-?bid/i

function bidMilestoneEvents(milestones: BidMilestone[], today: IsoDate): Omit<TimelineEvent, 'milestoneId'>[] {
  return milestones.flatMap((m) => {
    const date = calendarDay(m.dueAt)
    if (!date || m.key === 'submissionDeadline' || !QUERY_MILESTONE.test(`${m.key} ${m.label}`)) return []
    const done = m.status !== 'open'
    const missed = !done && toDay(date) < toDay(today)
    return [{
      id: `bidMilestone:${m.id}`, date, type: /clarif|meeting/i.test(m.label) ? 'Clarification' as const : 'Query' as const,
      severity: missed ? 'High' as const : 'Low' as const,
      title: m.label,
      description: [m.venue, m.notes].filter(Boolean).join(' · ') || undefined,
      status: done ? 'Resolved' as const : 'Open' as const,
    }]
  })
}

export function buildBidTimeline(input: BidTimelineInput): OpportunityTimeline {
  const rules = input.rules ?? BID_PHASE_RULES
  const startDate = calendarDay(input.bid.createdAt) ?? input.today
  const { endDate, estimated } = resolveEndDate(startDate, input.submissionDate)
  const plan = generatePlannedPlan(startDate, endDate, rules)
  const visits = stageIntervals(rules[0]?.key ?? input.bid.stageKey, startDate, input.stageChanges)
  const current = BID_STAGE_MAP[input.bid.stageKey]
  const ctx: StatusContext = {
    currentOrder: current?.order ?? 0,
    closed: !!current?.closed,
    today: input.today,
    terminalKey: rules[rules.length - 1]?.key ?? '',
    reachedOrder: Math.max(-1, ...[...visits.keys()].filter((k) => !BID_STAGE_MAP[k]?.closed).map((k) => BID_STAGE_MAP[k]?.order ?? -1)),
  }
  const base = plan.map((phase) => buildMilestone(phase, visits.get(phase.key), ctx))
  const events = [
    ...corrigendumEvents(input.corrigenda ?? []),
    ...followUpEvents(input.followUps ?? [], input.people, input.today),
    ...bidMilestoneEvents(input.milestones ?? [], input.today),
  ].map((e) => ({ ...e, milestoneId: milestoneForDate(base, e.date) }))
  const milestones = base.map((m) => ({ ...m, issueCount: events.filter((e) => e.milestoneId === m.id && e.status === 'Open').length }))
  return {
    opportunityId: input.bid.opportunityId,
    startDate, endDate, milestones, events,
    endDateEstimated: estimated,
    outcome: current?.closed ? current.label : null,
    latestNote: latestNote(input.followUps ?? [], input.people),
  }
}

/** The newest note written on the bid (next actions), with its author's avatar when known. */
export function latestNote(followUps: FollowUp[], people: BidTimelineInput['people']): TimelineNote | null {
  const newest = followUps.filter((f) => f.note.trim()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!newest) return null
  const by = newest.createdBy ?? ''
  const person = people?.find((p) => p.officialEmail && p.officialEmail.toLowerCase() === by.toLowerCase())
  return {
    text: newest.note.trim(), at: newest.createdAt,
    ...(person ? { author: person.name, authorPerson: { name: person.name, photoUrl: person.photoUrl ?? null } } : by ? { author: by } : {}),
  }
}

/** Open stages, in order — exported for callers that want the phase list without a bid. */
export const OPEN_BID_STAGES = BID_STAGES.filter((s) => !s.closed)

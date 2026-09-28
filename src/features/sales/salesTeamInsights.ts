import { buildSalesOrgTree } from './salesHierarchyTree'
import { attendeeSalesPersonId } from '@/lib/attendees'
import type {
  FollowUp, Opportunity, OwnershipAssignment, SalesPerson, SalesPosting, TimelineEvent,
} from '@/lib/types'

export interface TeamByManager {
  managerId: string
  managerName: string
  directReportCount: number
}
export interface OwnershipByPerson {
  salesPersonId: string
  name: string
  orgNode: number
  contact: number
  opportunity: number
  total: number
}
export interface FollowUpsByAssignee {
  /** null = follow-ups with no assignee set. */
  salesPersonId: string | null
  name: string
  count: number
}
export interface OpportunitiesByPerson {
  salesPersonId: string
  name: string
  count: number
}
export interface PipelineValueUnitTotal {
  unit: string
  total: number
  count: number
}
export interface PipelineValueByPerson {
  salesPersonId: string
  name: string
  totalsByUnit: PipelineValueUnitTotal[]
  unparseableCount: number
}
export interface ActivityByPerson {
  salesPersonId: string
  name: string
  count: number
}
export interface SalesTeamInsightsData {
  totalMembers: number
  statusBreakdown: Record<SalesPerson['status'], number>
  teamByManager: TeamByManager[]
  rootCount: number
  flaggedCount: number
  ownershipByPerson: OwnershipByPerson[]
  followUpsByAssignee: FollowUpsByAssignee[]
  opportunities: { byPerson: OpportunitiesByPerson[]; unattributedCount: number; ambiguousCount: number }
  pipelineValue: { byPerson: PipelineValueByPerson[] }
  activity: { byPerson: ActivityByPerson[]; reliableEventCount: number; excludedLegacyCount: number }
}

function nameOf(people: SalesPerson[], id: string | null): string {
  if (!id) return 'Unassigned'
  return people.find((p) => p.id === id)?.name ?? id
}

function isOpenAssignment(a: OwnershipAssignment, asOf: string): boolean {
  return a.startDate <= asOf && (a.endDate === null || asOf < a.endDate)
}

/** Parses a GOMS opportunity value field (`valueAmount`/`emdAmount`) safely.
 *  These are free TEXT — a blank string is the documented "not yet entered"
 *  default, never a real zero, so it's excluded rather than counted as ₹0.
 *  Anything else that doesn't parse to a finite number is excluded too,
 *  rather than silently coerced. */
export function parseOpportunityValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function computeSalesTeamInsights(input: {
  people: SalesPerson[]
  postings: Record<string, SalesPosting>
  ownership: OwnershipAssignment[]
  opportunities: Opportunity[]
  openFollowUps: FollowUp[]
  timelineEvents: TimelineEvent[]
  asOf: string
}): SalesTeamInsightsData {
  const { people, postings, ownership, opportunities, openFollowUps, timelineEvents, asOf } = input

  const statusBreakdown: Record<SalesPerson['status'], number> = {
    active: 0, onLeave: 0, resigned: 0, inactive: 0,
  }
  for (const p of people) statusBreakdown[p.status] += 1

  const tree = buildSalesOrgTree(people, postings)
  const teamByManager: TeamByManager[] = [...tree.childrenOf.entries()]
    .map(([managerId, kids]) => ({ managerId, managerName: nameOf(people, managerId), directReportCount: kids.length }))
    .sort((a, b) => b.directReportCount - a.directReportCount)

  const openOwnership = ownership.filter((a) => a.role === 'owner' && isOpenAssignment(a, asOf))
  const ownershipByPersonMap = new Map<string, OwnershipByPerson>()
  for (const a of openOwnership) {
    const row = ownershipByPersonMap.get(a.salesPersonId) ?? {
      salesPersonId: a.salesPersonId, name: nameOf(people, a.salesPersonId), orgNode: 0, contact: 0, opportunity: 0, total: 0,
    }
    if (a.entityType === 'orgNode') row.orgNode += 1
    else if (a.entityType === 'contact') row.contact += 1
    else if (a.entityType === 'opportunity') row.opportunity += 1
    row.total += 1
    ownershipByPersonMap.set(a.salesPersonId, row)
  }
  const ownershipByPerson = [...ownershipByPersonMap.values()].sort((a, b) => b.total - a.total)

  const followUpsByAssigneeMap = new Map<string | null, number>()
  for (const f of openFollowUps) followUpsByAssigneeMap.set(f.assigneeId, (followUpsByAssigneeMap.get(f.assigneeId) ?? 0) + 1)
  const followUpsByAssignee: FollowUpsByAssignee[] = [...followUpsByAssigneeMap.entries()]
    .map(([salesPersonId, count]) => ({ salesPersonId, name: nameOf(people, salesPersonId), count }))
    .sort((a, b) => b.count - a.count)

  // Opportunities: attribution ONLY via ownership_assignments — the legacy
  // `Opportunity.salesPersonEmail` field is transitional and unenforced, and
  // is never used to attribute a metric here.
  //
  // A well-formed roster has at most one OPEN owner-role assignment per
  // entity (enforced in the DB by
  // `ownership_assignments_one_open_owner_per_entity`), but this function
  // must not silently trust that invariant — if it's ever violated (bad
  // data, a race, an in-memory/dev repository without the constraint),
  // picking whichever row happens to come first/last in the array would be
  // exactly the kind of silent, ordering-dependent guess this page exists to
  // avoid. Such an opportunity is counted as ambiguous instead, separate
  // from "no owner at all" — never attributed, never blended.
  const openOwnersByOppId = new Map<string, string[]>()
  for (const a of openOwnership) {
    if (a.entityType !== 'opportunity') continue
    openOwnersByOppId.set(a.entityId, [...(openOwnersByOppId.get(a.entityId) ?? []), a.salesPersonId])
  }
  const opportunityOwnerByOppId = new Map<string, string>()
  let ambiguousCount = 0
  for (const [oppId, ownerIds] of openOwnersByOppId) {
    if (ownerIds.length === 1) opportunityOwnerByOppId.set(oppId, ownerIds[0])
    else ambiguousCount += 1
  }

  const oppByPersonMap = new Map<string, number>()
  let unattributedCount = 0
  for (const o of opportunities) {
    const ownerId = opportunityOwnerByOppId.get(o.id)
    if (ownerId) { oppByPersonMap.set(ownerId, (oppByPersonMap.get(ownerId) ?? 0) + 1); continue }
    // Exactly one of: no open owner row at all (unattributed), or 2+ open
    // owner rows (already counted above as ambiguous) — never both.
    if (!openOwnersByOppId.has(o.id)) unattributedCount += 1
  }
  const opportunitiesByPerson: OpportunitiesByPerson[] = [...oppByPersonMap.entries()]
    .map(([salesPersonId, count]) => ({ salesPersonId, name: nameOf(people, salesPersonId), count }))
    .sort((a, b) => b.count - a.count)

  // Pipeline value: grouped by (person, valueUnit) — never summed across
  // units, since 'lakh' and 'crore' rows would otherwise silently blend into
  // one meaningless number.
  const pipelineMap = new Map<string, PipelineValueByPerson>()
  for (const o of opportunities) {
    const ownerId = opportunityOwnerByOppId.get(o.id)
    if (!ownerId) continue
    const row = pipelineMap.get(ownerId) ?? { salesPersonId: ownerId, name: nameOf(people, ownerId), totalsByUnit: [], unparseableCount: 0 }
    const parsed = parseOpportunityValue(o.valueAmount)
    if (parsed === null) {
      row.unparseableCount += 1
    } else {
      const unit = o.valueUnit || 'unspecified'
      const existing = row.totalsByUnit.find((u) => u.unit === unit)
      if (existing) { existing.total += parsed; existing.count += 1 }
      else row.totalsByUnit.push({ unit, total: parsed, count: 1 })
    }
    pipelineMap.set(ownerId, row)
  }

  // Activity: only events with at least one ID-carrying attendee are
  // attributed to a salesperson — a legacy plain-name attendee can't be
  // reliably resolved to a SalesPerson.id, so it's excluded rather than
  // guessed at by string-matching a name.
  const activityByPersonMap = new Map<string, number>()
  let reliableEventCount = 0
  let excludedLegacyCount = 0
  for (const e of timelineEvents) {
    const ids = (e.attendees ?? []).map(attendeeSalesPersonId).filter((id): id is string => !!id)
    if (ids.length === 0) { excludedLegacyCount += 1; continue }
    reliableEventCount += 1
    for (const id of new Set(ids)) activityByPersonMap.set(id, (activityByPersonMap.get(id) ?? 0) + 1)
  }
  const activityByPerson: ActivityByPerson[] = [...activityByPersonMap.entries()]
    .map(([salesPersonId, count]) => ({ salesPersonId, name: nameOf(people, salesPersonId), count }))
    .sort((a, b) => b.count - a.count)

  return {
    totalMembers: people.length,
    statusBreakdown,
    teamByManager,
    rootCount: tree.roots.length,
    flaggedCount: tree.flaggedRootIds.size,
    ownershipByPerson,
    followUpsByAssignee,
    opportunities: { byPerson: opportunitiesByPerson, unattributedCount, ambiguousCount },
    pipelineValue: { byPerson: [...pipelineMap.values()] },
    activity: { byPerson: activityByPerson, reliableEventCount, excludedLegacyCount },
  }
}

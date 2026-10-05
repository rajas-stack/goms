import { describe, expect, it } from 'vitest'
import { computeSalesTeamInsights, parseOpportunityValue } from './salesTeamInsights'
import type {
  FollowUp, Opportunity, OwnershipAssignment, SalesPerson, SalesPosting, TimelineEvent,
} from '@/lib/types'

function person(id: string, name: string, status: SalesPerson['status'] = 'active'): SalesPerson {
  return {
    id, employeeCode: id, name, officialEmail: `${id}@amnex.com`, personalEmail: '',
    mobile: '', altMobile: '', joinedOn: null, leftOn: null, status,
    photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
  }
}
function posting(personId: string, managerId: string | null): SalesPosting {
  return {
    id: `post-${personId}`, salesPersonId: personId, designation: 'Rep', tierKey: 'accountManager',
    managerId, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null,
    changeType: 'initial', reason: '', createdAt: '', createdBy: null,
  }
}
function ownership(overrides: Partial<OwnershipAssignment>): OwnershipAssignment {
  return {
    id: 'own-1', entityType: 'orgNode', entityId: 'e1', salesPersonId: 'a', role: 'owner',
    startDate: '2024-01-01', endDate: null, reason: 'initial', batchId: null, note: '',
    createdAt: '', createdBy: null, ...overrides,
  }
}
function opportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: 'opp-1', opportunityCode: '', opportunityType: '', departmentId: 'd1', stateCode: 1, stageKey: 'pipeline', closedOn: null,
    opportunityName: 'Deal', gemTenderId: '', publishDate: '', submissionDate: '', vertical: '',
    component: [], quantity: '', currency: 'INR', valueAmount: '', valueUnit: 'lakh',
    budgetKnown: '', emdAmount: '', emdUnit: '', salesPersonEmail: '', createdAt: '', createdBy: null,
    ...overrides,
  }
}
function followUp(overrides: Partial<FollowUp>): FollowUp {
  return {
    id: 'fu-1', entityType: 'contact', entityId: 'e1', assigneeId: null, dueDate: '2026-01-01',
    status: 'open', note: '', createdAt: '', createdBy: null, ...overrides,
  }
}
function event(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'ev-1', employeeId: 'e1', type: 'meeting', title: 'Meeting', date: '2026-01-01',
    note: '', source: 'manual', ...overrides,
  }
}

const ASOF = '2026-06-01'

describe('parseOpportunityValue', () => {
  it('parses a plain number', () => expect(parseOpportunityValue('42.5')).toBe(42.5))
  it('strips thousands separators', () => expect(parseOpportunityValue('1,234')).toBe(1234))
  it('treats a blank string as missing, not zero', () => expect(parseOpportunityValue('')).toBeNull())
  it('treats non-numeric text as unparseable', () => expect(parseOpportunityValue('TBD')).toBeNull())
})

describe('computeSalesTeamInsights', () => {
  it('counts total members and status breakdown', () => {
    const people = [person('a', 'Alice', 'active'), person('b', 'Bob', 'onLeave')]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: [], opportunities: [], openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.totalMembers).toBe(2)
    expect(data.statusBreakdown).toEqual({ active: 1, onLeave: 1, resigned: 0, inactive: 0 })
  })

  it('derives team-by-manager from the same tree as the org chart', () => {
    const people = [person('a', 'Alice'), person('b', 'Bob'), person('c', 'Carol')]
    const postings = { b: posting('b', 'a'), c: posting('c', 'a') }
    const data = computeSalesTeamInsights({
      people, postings, ownership: [], opportunities: [], openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.teamByManager).toEqual([{ managerId: 'a', managerName: 'Alice', directReportCount: 2 }])
  })

  it('counts ownership only for open, role=owner assignments, split by entity type', () => {
    const people = [person('a', 'Alice')]
    const ownershipRows = [
      ownership({ entityType: 'orgNode', salesPersonId: 'a' }),
      ownership({ entityType: 'contact', salesPersonId: 'a', id: 'own-2' }),
      ownership({ entityType: 'orgNode', salesPersonId: 'a', id: 'own-3', role: 'delegate' }),
      ownership({ entityType: 'orgNode', salesPersonId: 'a', id: 'own-4', endDate: '2025-01-01' }), // closed before asOf
    ]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: ownershipRows, opportunities: [], openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.ownershipByPerson).toEqual([{ salesPersonId: 'a', name: 'Alice', orgNode: 1, contact: 1, opportunity: 0, total: 2 }])
  })

  it('groups open follow-ups by assignee, with a distinct Unassigned bucket', () => {
    const people = [person('a', 'Alice')]
    const followUps = [followUp({ assigneeId: 'a' }), followUp({ assigneeId: 'a', id: 'fu-2' }), followUp({ assigneeId: null, id: 'fu-3' })]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: [], opportunities: [], openFollowUps: followUps, timelineEvents: [], asOf: ASOF,
    })
    expect(data.followUpsByAssignee).toContainEqual({ salesPersonId: 'a', name: 'Alice', count: 2 })
    expect(data.followUpsByAssignee).toContainEqual({ salesPersonId: null, name: 'Unassigned', count: 1 })
  })

  it('attributes opportunities only via ownership_assignments, never salesPersonEmail, and counts the rest as unattributed', () => {
    const people = [person('a', 'Alice')]
    const opportunities = [
      opportunity({ id: 'opp-owned', salesPersonEmail: 'someone-else@amnex.com' }),
      opportunity({ id: 'opp-bare', salesPersonEmail: 'a@amnex.com' }), // legacy field only — must NOT be attributed
    ]
    const ownershipRows = [ownership({ entityType: 'opportunity', entityId: 'opp-owned', salesPersonId: 'a' })]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: ownershipRows, opportunities, openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.opportunities.byPerson).toEqual([{ salesPersonId: 'a', name: 'Alice', count: 1 }])
    expect(data.opportunities.unattributedCount).toBe(1)
  })

  it('treats an opportunity with more than one open owner assignment as ambiguous, never picking one by array order', () => {
    const people = [person('a', 'Alice'), person('b', 'Bob')]
    const opportunities = [opportunity({ id: 'opp-conflict' })]
    // The DB's `ownership_assignments_one_open_owner_per_entity` constraint
    // should prevent this, but the pure function must not assume the
    // invariant holds — it must never resolve the conflict by picking
    // whichever row happens to come first or last.
    const ownershipRows = [
      ownership({ id: 'own-a', entityType: 'opportunity', entityId: 'opp-conflict', salesPersonId: 'a' }),
      ownership({ id: 'own-b', entityType: 'opportunity', entityId: 'opp-conflict', salesPersonId: 'b' }),
    ]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: ownershipRows, opportunities, openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    expect(data.opportunities.byPerson).toEqual([])
    expect(data.opportunities.unattributedCount).toBe(0)
    expect(data.opportunities.ambiguousCount).toBe(1)
  })

  it('groups pipeline value by unit and never blends lakh with crore, excluding unparseable amounts', () => {
    const people = [person('a', 'Alice')]
    const opportunities = [
      opportunity({ id: 'o1', valueAmount: '10', valueUnit: 'lakh' }),
      opportunity({ id: 'o2', valueAmount: '20', valueUnit: 'lakh' }),
      opportunity({ id: 'o3', valueAmount: '3', valueUnit: 'crore' }),
      opportunity({ id: 'o4', valueAmount: 'TBD', valueUnit: 'lakh' }),
    ]
    const ownershipRows = opportunities.map((o) => ownership({ entityType: 'opportunity', entityId: o.id, salesPersonId: 'a', id: `own-${o.id}` }))
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: ownershipRows, opportunities, openFollowUps: [], timelineEvents: [], asOf: ASOF,
    })
    const row = data.pipelineValue.byPerson[0]
    expect(row.totalsByUnit).toContainEqual({ unit: 'lakh', total: 30, count: 2 })
    expect(row.totalsByUnit).toContainEqual({ unit: 'crore', total: 3, count: 1 })
    expect(row.unparseableCount).toBe(1)
  })

  it('counts activity only from events with an ID-carrying attendee, excluding legacy name-only entries', () => {
    const people = [person('a', 'Alice')]
    const events = [
      event({ id: 'ev-a', attendees: [{ salesPersonId: 'a', name: 'Alice' }] }),
      event({ id: 'ev-legacy', attendees: ['Alice Anderson'] }),
      event({ id: 'ev-none' }),
    ]
    const data = computeSalesTeamInsights({
      people, postings: {}, ownership: [], opportunities: [], openFollowUps: [], timelineEvents: events, asOf: ASOF,
    })
    expect(data.activity.byPerson).toEqual([{ salesPersonId: 'a', name: 'Alice', count: 1 }])
    expect(data.activity.reliableEventCount).toBe(1)
    expect(data.activity.excludedLegacyCount).toBe(2)
  })
})

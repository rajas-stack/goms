import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { DepartmentSection } from './DepartmentSection'
import type { Employee, HierNode, TimelineEvent } from '@/lib/types'

// This suite is scoped to Task 8.5's new "Meetings" section — every other
// piece of DepartmentSection (head, sales ownership, Works pipeline) is
// exercised elsewhere, so their hooks/children are stubbed to empty/no-op.
vi.mock('@/features/workspace/context', () => ({ useWorkspace: () => ({ select: vi.fn() }) }))
vi.mock('@/features/nodes/WorksEditor', () => ({ WorksEditor: () => null }))
vi.mock('@/features/sales/OwnershipBlock', () => ({ OwnershipBlock: () => null }))

function makeNode(overrides: Partial<HierNode> = {}): HierNode {
  return {
    id: 'dept-1', domain: 'org', typeKey: 'department', parentId: null, stateCode: 27,
    name: 'Health', code: null, sortOrder: 0, metadata: {}, status: 'active',
    ...overrides,
  }
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1', code: 'C1', name: 'Some Person', designation: 'Officer',
    email: '', phone: '', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: null, managerId: null, vacant: false, connected: false,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: {}, status: 'active',
    ...overrides,
  }
}

function makeTimelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1', employeeId: 'emp-1', type: 'meeting', title: 'Budget review',
    date: '2026-01-01', note: '', source: 'manual',
    ...overrides,
  }
}

function stubHooks(opts: {
  deptById?: Record<string, { id: string; name: string }>
  timelineEvents?: TimelineEvent[]
}) {
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useCurrentPostings>)
  vi.spyOn(api, 'useOpportunitiesByDepartment').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpportunitiesByDepartment>)
  vi.spyOn(api, 'useResolvedOwners').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useResolvedOwners>)
  vi.spyOn(api, 'useNode').mockReturnValue({ data: undefined } as unknown as ReturnType<typeof api.useNode>)
  vi.spyOn(api, 'useSalesPerson').mockReturnValue({ data: undefined } as unknown as ReturnType<typeof api.useSalesPerson>)
  vi.spyOn(api, 'useSalesPostings').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useSalesPostings>)
  vi.spyOn(api, 'useEmployeeDepartments').mockReturnValue({ data: opts.deptById ?? {} } as unknown as ReturnType<typeof api.useEmployeeDepartments>)
  vi.spyOn(api, 'useAllTimelineEvents').mockReturnValue({ data: opts.timelineEvents ?? [] } as unknown as ReturnType<typeof api.useAllTimelineEvents>)
}

describe('DepartmentSection — Meetings section (Task 8.5)', () => {
  it('shows a meeting logged against a direct-child employee of the department', () => {
    const node = makeNode({ id: 'dept-1' })
    const event = makeTimelineEvent({ id: 'evt-1', employeeId: 'emp-direct', title: 'Direct child meeting' })
    stubHooks({
      deptById: { 'emp-direct': { id: 'dept-1', name: 'Health' } },
      timelineEvents: [event],
    })

    render(<DepartmentSection node={node} employees={[makeEmployee({ id: 'emp-direct' })]} />)

    expect(screen.getByText('Direct child meeting')).toBeInTheDocument()
  })

  it('shows a meeting logged against an employee several levels down (subtree), via the resolved-department join', () => {
    const node = makeNode({ id: 'dept-1' })
    // deptById already resolves each employee to their *nearest ancestor
    // department* regardless of how many office/unit levels sit in between —
    // this is what makes the section subtree-inclusive with no separate walk.
    const event = makeTimelineEvent({ id: 'evt-deep', employeeId: 'emp-deep', title: 'Deep subtree meeting' })
    stubHooks({
      deptById: { 'emp-deep': { id: 'dept-1', name: 'Health' } },
      timelineEvents: [event],
    })

    render(<DepartmentSection node={node} employees={[makeEmployee({ id: 'emp-deep' })]} />)

    expect(screen.getByText('Deep subtree meeting')).toBeInTheDocument()
  })

  it('does not show a meeting logged against an employee under a different department', () => {
    const node = makeNode({ id: 'dept-1' })
    const event = makeTimelineEvent({ id: 'evt-other', employeeId: 'emp-other', title: 'Other department meeting' })
    stubHooks({
      deptById: { 'emp-other': { id: 'dept-2', name: 'Roads' } },
      timelineEvents: [event],
    })

    render(<DepartmentSection node={node} employees={[makeEmployee({ id: 'emp-other' })]} />)

    expect(screen.queryByText('Other department meeting')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Meetings/)).not.toBeInTheDocument()
  })

  it('renders the exact same record (same id) as would show on the employee page — not a duplicate/copy', () => {
    const node = makeNode({ id: 'dept-1' })
    const event = makeTimelineEvent({ id: 'evt-shared', employeeId: 'emp-direct', title: 'Shared record' })
    stubHooks({
      deptById: { 'emp-direct': { id: 'dept-1', name: 'Health' } },
      timelineEvents: [event],
    })

    render(<DepartmentSection node={node} employees={[makeEmployee({ id: 'emp-direct' })]} />)

    // Exactly one rendering of this entry's title — this section reads the
    // same `TimelineEvent[]` (same ids) rather than constructing its own copy.
    expect(screen.getAllByText('Shared record')).toHaveLength(1)
  })
})

// Task 9.2: the department head row shows an avatar next to the resolved
// employee's name (same {name, photoUrl, vacant} shape ChainRow already uses
// for the reporting chain, since `head` is a real Employee record).
describe('DepartmentSection — department head avatar (Task 9.2)', () => {
  it('shows an avatar next to the department head', () => {
    const node = makeNode({ id: 'dept-1', metadata: { deptHead: 'emp-head' } })
    const head = makeEmployee({ id: 'emp-head', name: 'Head Person', photoUrl: null })
    stubHooks({})

    render(<DepartmentSection node={node} employees={[head]} />)

    expect(screen.getByText('Head Person')).toBeInTheDocument()
    expect(screen.getAllByTestId('avatar').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

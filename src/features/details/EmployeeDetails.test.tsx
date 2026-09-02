import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { EmployeeDetails } from './EmployeeDetails'
import type { Employee, TimelineEvent } from '@/lib/types'

beforeEach(() => {
  // jsdom has no ResizeObserver; FitText (the header name) uses one purely
  // to recompute font-fit sizing, which this suite never asserts on. Mirrors
  // HierarchyCanvas.test.tsx's stub.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

// Task 9.1 (Avatar rollout): ChainRow's photo-vs-initials rendering was a
// real pre-existing bug fix — the reporting-chain rows used to render an
// ad-hoc initials div with no photo support at all, so a photoUrl'd manager
// or report never showed a picture. This suite is scoped to that bug fix,
// not the rest of EmployeeDetails's many actions/dialogs — those are
// mocked out, mirroring EmployeeFormDialog.test.tsx and
// SalesPersonDetails.test.tsx's approach to unrelated child dialogs.
vi.mock('@/features/employees/EmployeeFormDialog', () => ({ EmployeeFormDialog: () => null }))
vi.mock('@/features/employees/MarkDuplicateDialog', () => ({ MarkDuplicateDialog: () => null }))
vi.mock('@/features/employees/MergeEmployeesDialog', () => ({ MergeEmployeesDialog: () => null }))
// Task 8.4: mocked with a small visible marker (rather than `() => null`) so
// this file's Edit-button test can assert the dialog actually receives the
// clicked entry as `existingEvent`, not just that the dialog opened.
vi.mock('@/features/employees/TimelineEventDialog', () => ({
  TimelineEventDialog: (props: { open: boolean; existingEvent?: { id: string; title: string } }) =>
    props.open ? <div data-testid="timeline-dialog">{props.existingEvent ? `editing:${props.existingEvent.title}` : 'add-mode'}</div> : null,
}))
vi.mock('@/features/employees/TransferDialog', () => ({ TransferDialog: () => null }))
vi.mock('@/features/employees/ChargeDialog', () => ({ ChargeDialog: () => null }))
vi.mock('@/features/employees/VisitingCard', () => ({ VisitingCard: () => null }))
vi.mock('@/features/sales/OwnershipBlock', () => ({ OwnershipBlock: () => null }))

vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ selection: null, select: vi.fn(), clearSelection: vi.fn(), editEmployee: vi.fn(), addEmployee: vi.fn() }),
}))

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1', code: 'C1', name: 'Existing Person', designation: 'Officer',
    email: '', phone: '', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: null, managerId: null, vacant: false, connected: false,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: {}, status: 'active',
    ...overrides,
  }
}

function stubApiHooks(opts: { employee: Employee; chain?: Employee[]; reports?: Employee[]; timeline?: TimelineEvent[] }) {
  vi.spyOn(api, 'useEmployee').mockImplementation((id: string | null) =>
    ({ data: id === opts.employee.id ? opts.employee : null } as unknown as ReturnType<typeof api.useEmployee>))
  vi.spyOn(api, 'useReportingChain').mockReturnValue({ data: opts.chain ?? [] } as unknown as ReturnType<typeof api.useReportingChain>)
  vi.spyOn(api, 'useDirectReports').mockReturnValue({ data: opts.reports ?? [] } as unknown as ReturnType<typeof api.useDirectReports>)
  vi.spyOn(api, 'useNode').mockReturnValue({ data: null } as unknown as ReturnType<typeof api.useNode>)
  vi.spyOn(api, 'useBreadcrumb').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useBreadcrumb>)
  vi.spyOn(api, 'useTimeline').mockReturnValue({ data: opts.timeline ?? [] } as unknown as ReturnType<typeof api.useTimeline>)
  vi.spyOn(api, 'useTransfers').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useTransfers>)
  vi.spyOn(api, 'useFollowUps').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useFollowUps>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useEmployeeDepartments').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useEmployeeDepartments>)
  vi.spyOn(api, 'useResolvedOwners').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useResolvedOwners>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useCurrentPostings>)
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    remove: { mutateAsync: vi.fn() },
    removeCharge: { mutateAsync: vi.fn() },
    setManager: { mutateAsync: vi.fn() },
    setTimelineEventAttended: { mutate: vi.fn() },
    updateTimelineEvent: { mutateAsync: vi.fn() },
    update: { mutateAsync: vi.fn() },
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
}

describe('EmployeeDetails — ChainRow Avatar rollout (Task 9.1)', () => {
  it('renders a photo for a reporting-chain manager whose photoUrl is set', () => {
    const emp = makeEmployee()
    const manager = makeEmployee({ id: 'mgr-1', name: 'Manager Boss', photoUrl: 'https://example.com/mgr.jpg' })
    stubApiHooks({ employee: emp, chain: [manager] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    const img = screen.getByAltText('Manager Boss')
    expect(img).toHaveAttribute('src', 'https://example.com/mgr.jpg')
  })

  it('renders initials for a reporting-chain manager with no photoUrl', () => {
    const emp = makeEmployee()
    const manager = makeEmployee({ id: 'mgr-1', name: 'Manager Boss', photoUrl: null })
    stubApiHooks({ employee: emp, chain: [manager] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    expect(screen.getByText('MB')).toBeInTheDocument()
    expect(screen.queryByAltText('Manager Boss')).not.toBeInTheDocument()
  })

  it('renders a photo for a direct report whose photoUrl is set', () => {
    const emp = makeEmployee()
    const report = makeEmployee({ id: 'rep-1', name: 'Report Person', photoUrl: 'https://example.com/rep.jpg' })
    stubApiHooks({ employee: emp, reports: [report] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    const img = screen.getByAltText('Report Person')
    expect(img).toHaveAttribute('src', 'https://example.com/rep.jpg')
  })
})

function makeTimelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1', employeeId: 'emp-1', type: 'meeting', title: 'Budget review',
    date: '2026-01-01', note: '', source: 'manual',
    ...overrides,
  }
}

// Task 8.2 (Item 13): Agenda/Outcome/Next Steps must each render in their own
// labeled section when present, and must add nothing to the timeline entry
// when absent — so old entries (which have none of these fields) look
// exactly as they did before this feature shipped.
describe('EmployeeDetails — Timeline Agenda/Outcome/Next Steps display (Task 8.2)', () => {
  it('shows each populated field in its own labeled section', () => {
    const emp = makeEmployee()
    const event = makeTimelineEvent({
      agenda: 'Discuss Q1 budget', outcome: 'Approved with revisions', nextSteps: 'Send revised sheet by Friday',
    })
    stubApiHooks({ employee: emp, timeline: [event] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    expect(screen.getByText('Agenda:')).toBeInTheDocument()
    expect(screen.getByText('Discuss Q1 budget')).toBeInTheDocument()
    expect(screen.getByText('Outcome:')).toBeInTheDocument()
    expect(screen.getByText('Approved with revisions')).toBeInTheDocument()
    expect(screen.getByText('Next steps:')).toBeInTheDocument()
    expect(screen.getByText('Send revised sheet by Friday')).toBeInTheDocument()
  })

  it('renders nothing extra for an old entry with no agenda/outcome/nextSteps', () => {
    const emp = makeEmployee()
    const event = makeTimelineEvent({ note: 'Just a plain note' })
    stubApiHooks({ employee: emp, timeline: [event] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    expect(screen.getByText('Just a plain note')).toBeInTheDocument()
    expect(screen.queryByText('Agenda:')).not.toBeInTheDocument()
    expect(screen.queryByText('Outcome:')).not.toBeInTheDocument()
    expect(screen.queryByText('Next steps:')).not.toBeInTheDocument()
  })
})

// Task 8.3: attendees can now be a mix of legacy plain strings and new
// {salesPersonId, name} snapshots within the SAME event's array (a record
// added before this change, later appended to via draft restore, or just two
// eras of data sitting side by side) — the display line must render both
// shapes correctly via the attendeeName() normalizer rather than assuming
// every entry is a string.
describe('EmployeeDetails — attendee display, mixed legacy/new shapes (Task 8.3)', () => {
  it('renders both legacy plain-string and new {salesPersonId, name} attendees in one event', () => {
    const emp = makeEmployee()
    const event = makeTimelineEvent({
      attendees: ['Legacy Name', { salesPersonId: 'sp-1', name: 'New Snapshot Name' }],
    })
    stubApiHooks({ employee: emp, timeline: [event] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    expect(screen.getByText('Attendees: Legacy Name, New Snapshot Name')).toBeInTheDocument()
  })

  it('renders nothing for an event with no attendees', () => {
    const emp = makeEmployee()
    const event = makeTimelineEvent({ attendees: undefined })
    stubApiHooks({ employee: emp, timeline: [event] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    expect(screen.queryByText(/^Attendees:/)).not.toBeInTheDocument()
  })
})

// Task 8.4 (Item 14): a manual entry gets a per-entry Edit button that opens
// TimelineEventDialog with `existingEvent` set to that exact record — a
// system-generated entry (joined/transferred) gets none, since there's
// nothing user-editable about it.
describe('EmployeeDetails — per-entry Edit action (Task 8.4)', () => {
  it('clicking Edit on a manual entry opens the dialog with that record as existingEvent', async () => {
    const user = userEvent.setup()
    const emp = makeEmployee()
    const event = makeTimelineEvent({ id: 'evt-42', title: 'Quarterly review', source: 'manual' })
    stubApiHooks({ employee: emp, timeline: [event] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    expect(screen.queryByTestId('timeline-dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit quarterly review/i }))

    expect(screen.getByTestId('timeline-dialog')).toHaveTextContent('editing:Quarterly review')
  })

  it('does not show an Edit button on a system-generated entry', () => {
    const emp = makeEmployee()
    const event = makeTimelineEvent({ id: 'evt-joined', type: 'joined', title: 'Contact created', source: 'system' })
    stubApiHooks({ employee: emp, timeline: [event] })

    render(<MemoryRouter><EmployeeDetails employeeId="emp-1" /></MemoryRouter>)

    expect(screen.queryByRole('button', { name: /edit contact created/i })).not.toBeInTheDocument()
  })
})

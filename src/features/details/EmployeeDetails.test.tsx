import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { EmployeeDetails } from './EmployeeDetails'
import type { Employee } from '@/lib/types'

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
vi.mock('@/features/employees/TimelineEventDialog', () => ({ TimelineEventDialog: () => null }))
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

function stubApiHooks(opts: { employee: Employee; chain?: Employee[]; reports?: Employee[] }) {
  vi.spyOn(api, 'useEmployee').mockImplementation((id: string | null) =>
    ({ data: id === opts.employee.id ? opts.employee : null } as unknown as ReturnType<typeof api.useEmployee>))
  vi.spyOn(api, 'useReportingChain').mockReturnValue({ data: opts.chain ?? [] } as unknown as ReturnType<typeof api.useReportingChain>)
  vi.spyOn(api, 'useDirectReports').mockReturnValue({ data: opts.reports ?? [] } as unknown as ReturnType<typeof api.useDirectReports>)
  vi.spyOn(api, 'useNode').mockReturnValue({ data: null } as unknown as ReturnType<typeof api.useNode>)
  vi.spyOn(api, 'useBreadcrumb').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useBreadcrumb>)
  vi.spyOn(api, 'useTimeline').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useTimeline>)
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

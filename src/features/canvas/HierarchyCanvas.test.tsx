import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { HierarchyCanvas } from './HierarchyCanvas'
import type { Employee, HierNode } from '@/lib/types'

// The real WorkspaceProvider drags in routing + every workspace dialog; none
// of that is under test here (this suite is about the People-canvas search
// predicate), so it's replaced with the minimal shape HierarchyCanvas reads.
vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({
    stateCode: 5,
    selection: null,
    select: vi.fn(),
    clearSelection: vi.fn(),
    createChild: vi.fn(),
    createDepartment: vi.fn(),
    editNode: vi.fn(),
    moveNode: vi.fn(),
    deleteNode: vi.fn(),
    addEmployee: vi.fn(),
    selectEmployee: vi.fn(),
    editEmployee: vi.fn(),
  }),
}))

const DEPARTMENT: HierNode = {
  id: 'dept-1', domain: 'org', typeKey: 'department', parentId: null, stateCode: 5,
  name: 'Health Department', code: null, sortOrder: 0, metadata: {}, status: 'active',
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'e1', code: 'C1', name: 'Person', designation: 'Officer',
    email: 'person@gov.in', phone: '+91 9876543210', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: 'dept-1', managerId: null, vacant: false, connected: true,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: {}, status: 'active',
    ...overrides,
  }
}

// Three root reports (no manager in the department, so `rootReportsOf`
// treats each as top-of-chain) plus a manager who sits outside the
// department subtree entirely — used to prove manager-name search still
// resolves via the full state-scoped employee list.
const OUTSIDE_MANAGER: Employee = makeEmployee({
  id: 'mgr-outside', name: 'Priya Shah', designation: 'Head Office Director', orgNodeId: 'other-node',
})
const ALICE = makeEmployee({ id: 'e-alice', name: 'Alice Verma', designation: 'Assistant Engineer', email: 'alice.verma@gov.in', phone: '+91 9000000001' })
const BOB = makeEmployee({ id: 'e-bob', name: 'Bob Kumar', designation: 'Junior Engineer', email: 'bob.kumar@gov.in', phone: '+91 9000000002' })
const CAROL = makeEmployee({
  id: 'e-carol', name: 'Carol Singh', designation: 'Deputy Director', email: 'carol.singh@gov.in',
  phone: '+91 9000000003', managerId: 'mgr-outside',
})

function stubHooks() {
  vi.spyOn(api, 'useStateNode').mockReturnValue({ data: { ...DEPARTMENT, id: 'state-5', name: 'Test State' } } as unknown as ReturnType<typeof api.useStateNode>)
  vi.spyOn(api, 'useOrgRoots').mockReturnValue({ data: [DEPARTMENT] } as unknown as ReturnType<typeof api.useOrgRoots>)
  vi.spyOn(api, 'useEmployeesByState').mockReturnValue({ data: [ALICE, BOB, CAROL, OUTSIDE_MANAGER] } as unknown as ReturnType<typeof api.useEmployeesByState>)
  vi.spyOn(api, 'useNode').mockReturnValue({ data: null } as unknown as ReturnType<typeof api.useNode>)
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    remove: {}, create: {}, update: {}, addTimelineEvent: {}, setManager: {},
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
  vi.spyOn(api, 'useBreadcrumb').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useBreadcrumb>)
  vi.spyOn(api, 'useEmployee').mockReturnValue({ data: null } as unknown as ReturnType<typeof api.useEmployee>)
  vi.spyOn(api, 'useEmployeesUnder').mockReturnValue({ data: [ALICE, BOB, CAROL] } as unknown as ReturnType<typeof api.useEmployeesUnder>)
  // CanvasBranch-level hooks (each rendered root card calls these):
  vi.spyOn(api, 'useDirectReports').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useDirectReports>)
  vi.spyOn(api, 'useChildren').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useChildren>)
  vi.spyOn(api, 'useEmployeesDirect').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useEmployeesDirect>)
  vi.spyOn(api, 'useNodeMutations').mockReturnValue({
    move: {}, reorder: {}, create: {}, update: {}, remove: {},
  } as unknown as ReturnType<typeof api.useNodeMutations>)
}

beforeEach(() => {
  // jsdom has no ResizeObserver; HierarchyCanvas uses one purely to recompute
  // connector-line positions on resize, which this suite never asserts on.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  // jsdom also has no Pointer Events capture API; the canvas viewport's
  // pan/pinch handler calls it on every pointerdown bubbling up from a typed
  // key inside the search input's ancestry.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  stubHooks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HierarchyCanvas — People-canvas search (item 7)', () => {
  it('filters rendered People cards by a partial name match', async () => {
    const user = userEvent.setup()
    render(<HierarchyCanvas domain="people" stateCode={5} />)

    expect(await screen.findByText('Alice Verma')).toBeInTheDocument()
    expect(screen.getByText('Bob Kumar')).toBeInTheDocument()
    expect(screen.getByText('Carol Singh')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Search people'), 'alice')

    expect(screen.getByText('Alice Verma')).toBeInTheDocument()
    expect(screen.queryByText('Bob Kumar')).not.toBeInTheDocument()
    expect(screen.queryByText('Carol Singh')).not.toBeInTheDocument()
  })

  it('filters by a phone-number substring even when it does not match any name', async () => {
    const user = userEvent.setup()
    render(<HierarchyCanvas domain="people" stateCode={5} />)
    await screen.findByText('Alice Verma')

    await user.type(screen.getByLabelText('Search people'), '9000000002')

    expect(screen.queryByText('Alice Verma')).not.toBeInTheDocument()
    expect(screen.getByText('Bob Kumar')).toBeInTheDocument()
    expect(screen.queryByText('Carol Singh')).not.toBeInTheDocument()
  })

  it('filters by the reporting manager name for a card whose manager is outside the department', async () => {
    const user = userEvent.setup()
    render(<HierarchyCanvas domain="people" stateCode={5} />)
    await screen.findByText('Alice Verma')

    await user.type(screen.getByLabelText('Search people'), 'priya shah')

    expect(screen.queryByText('Alice Verma')).not.toBeInTheDocument()
    expect(screen.queryByText('Bob Kumar')).not.toBeInTheDocument()
    expect(screen.getByText('Carol Singh')).toBeInTheDocument()
  })

  it('does not render the People search input (or any of its state) in the Organization view', async () => {
    render(<HierarchyCanvas domain="org" stateCode={5} />)
    await screen.findByText('Department of Health Department')

    expect(screen.queryByLabelText('Search people')).not.toBeInTheDocument()
    // The Organization view's own DepartmentCombobox still renders untouched.
    expect(screen.getByPlaceholderText('Search departments…')).toBeInTheDocument()
  })

  it('leaves the existing department DepartmentCombobox working alongside the new search', async () => {
    render(<HierarchyCanvas domain="people" stateCode={5} />)
    await screen.findByText('Alice Verma')

    // The department picker's own search input is unrelated to the new
    // people-search box — both render side by side without conflict.
    expect(screen.getByPlaceholderText('Search departments…')).toBeInTheDocument()
    expect(screen.getByLabelText('Search people')).toBeInTheDocument()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { NodeDetails } from './NodeDetails'
import { serializeContactNumbers } from '@/features/nodes/contact-numbers'
import type { HierNode } from '@/lib/types'

// Item 2: the Department Contact section must actually render the
// State/District/contact-numbers data DepartmentFields.tsx captures — before
// this fix, NodeDetails only rendered website/departmentEmail/officeAddress
// and silently dropped everything the State/District/multi-number block
// wrote to metadata (contactStateNodeId/contactDistrictNodeId/contactNumbers).
vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ select: vi.fn(), editNode: vi.fn(), moveNode: vi.fn(), deleteNode: vi.fn() }),
}))
vi.mock('./DepartmentSection', () => ({ DepartmentSection: () => null }))

function makeNode(overrides: Partial<HierNode> & { id: string }): HierNode {
  return {
    domain: 'org', typeKey: 'department', parentId: null, stateCode: 21,
    name: overrides.id, code: null, sortOrder: 0, metadata: {}, status: 'active',
    ...overrides,
  }
}

function stubHooks(opts: { node: HierNode; byId?: Record<string, HierNode> }) {
  const byId = opts.byId ?? {}
  vi.spyOn(api, 'useNode').mockImplementation((id: string | null) =>
    ({ data: id === opts.node.id ? opts.node : id ? byId[id] : undefined } as unknown as ReturnType<typeof api.useNode>))
  vi.spyOn(api, 'useBreadcrumb').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useBreadcrumb>)
  vi.spyOn(api, 'useChildren').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useChildren>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useEmployeesUnder').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useEmployeesUnder>)
  vi.spyOn(api, 'useNodeMutations').mockReturnValue({ setStatus: { mutateAsync: vi.fn() } } as unknown as ReturnType<typeof api.useNodeMutations>)
}

beforeEach(() => {
  vi.restoreAllMocks()
  // jsdom has no ResizeObserver; FitText (used by every DetailRow's value)
  // uses one purely to recompute font-fit sizing, which this suite never
  // asserts on. Mirrors EmployeeDetails.test.tsx's stub.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

describe('NodeDetails — Department Contact: State/District/contact numbers display (Item 2)', () => {
  it('shows the resolved State and District names alongside the contact numbers', () => {
    const state = makeNode({ id: 'state-1', typeKey: 'state', name: 'Odisha' })
    const district = makeNode({ id: 'dist-1', typeKey: 'district', name: 'Khordha', parentId: 'state-1' })
    const dept = makeNode({
      id: 'dept-1',
      metadata: {
        contactStateNodeId: 'state-1',
        contactDistrictNodeId: 'dist-1',
        contactNumbers: serializeContactNumbers([{ type: 'landline', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' }]),
      },
    })
    stubHooks({ node: dept, byId: { 'state-1': state, 'dist-1': district } })

    render(<NodeDetails nodeId="dept-1" />)

    expect(screen.getByText('Odisha')).toBeInTheDocument()
    expect(screen.getByText('Khordha')).toBeInTheDocument()
    expect(screen.getByText('Bhubaneswar')).toBeInTheDocument()
    expect(screen.getByText('STD 0674')).toBeInTheDocument()
    // Domestic display combines the STD code back with the local number
    // (never +91 — see PhoneInput.tsx/NodeDetails.tsx's own comment on why).
    expect(screen.getByText('0674 2345678')).toBeInTheDocument()
  })

  it('shows a mobile entry with its +91 prefix and no STD code', () => {
    const dept = makeNode({
      id: 'dept-1',
      metadata: {
        contactNumbers: serializeContactNumbers([{ type: 'mobile', city: '', stdCode: '', number: '+91 9812345678' }]),
      },
    })
    stubHooks({ node: dept })

    render(<NodeDetails nodeId="dept-1" />)

    expect(screen.getByText('+91 9812345678')).toBeInTheDocument()
    expect(screen.queryByText(/^STD /)).not.toBeInTheDocument()
  })

  it('renders every entry when multiple contact numbers were added', () => {
    const dept = makeNode({
      id: 'dept-1',
      metadata: {
        contactNumbers: serializeContactNumbers([
          { type: 'landline', city: 'Bhubaneswar', stdCode: '0674', number: '2345678' },
          { type: 'landline', city: 'Cuttack', stdCode: '0671', number: '2345678' },
        ]),
      },
    })
    stubHooks({ node: dept })

    render(<NodeDetails nodeId="dept-1" />)

    expect(screen.getByText('Bhubaneswar')).toBeInTheDocument()
    expect(screen.getByText('Cuttack')).toBeInTheDocument()
  })

  it('shows nothing extra for a department with no contact-number data at all (no crash, no empty section)', () => {
    const dept = makeNode({ id: 'dept-1', metadata: {} })
    stubHooks({ node: dept })

    render(<NodeDetails nodeId="dept-1" />)

    expect(screen.queryByText('Contact numbers')).not.toBeInTheDocument()
  })

  it('does not require a State/District to still show contact numbers (e.g. a Central Ministries department)', () => {
    const dept = makeNode({
      id: 'dept-1',
      metadata: { contactNumbers: serializeContactNumbers([{ type: 'landline', city: 'New Delhi', stdCode: '011', number: '23456789' }]) },
    })
    stubHooks({ node: dept })

    render(<NodeDetails nodeId="dept-1" />)

    expect(screen.getByText('New Delhi')).toBeInTheDocument()
  })
})

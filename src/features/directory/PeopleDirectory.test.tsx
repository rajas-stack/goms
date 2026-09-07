import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '@/lib/api'
import { PeopleDirectory } from './PeopleDirectory'
import type { Employee } from '@/lib/types'

vi.mock('@/features/workspace/context', () => ({ useWorkspace: () => ({ selection: null, select: vi.fn() }) }))
vi.mock('@/lib/useMediaQuery', () => ({ useMediaQuery: () => false }))
// jsdom's 0-height scroll container makes @tanstack/react-virtual's real
// windowing report zero visible rows — this test cares about the filter
// logic feeding the list, not the virtualization itself, so it's replaced
// with a no-windowing fake that renders every row.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 50,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 50, size: 50 })),
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}))

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1', code: 'C1', name: 'Someone', designation: 'Officer',
    email: 'someone@gov.in', phone: '9876543210', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: 'node-1', managerId: null, vacant: false, connected: false,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: {}, status: 'active',
    ...overrides,
  }
}

function stub() {
  vi.spyOn(api, 'useEmployeeDepartments').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useEmployeeDepartments>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
}

function renderDirectory(employees: Employee[]) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <PeopleDirectory employees={employees} />
    </QueryClientProvider>,
  )
}

describe('PeopleDirectory — List view search (item 7)', () => {
  it('filters people by a partial, case-insensitive match on name', async () => {
    stub()
    const user = userEvent.setup()
    renderDirectory([
      makeEmployee({ id: 'e1', name: 'Asha Rao' }),
      makeEmployee({ id: 'e2', name: 'Bilal Khan' }),
    ])

    await user.type(screen.getByPlaceholderText(/search by name/i), 'asha')

    expect(screen.getByTestId('person-row-e1')).toBeInTheDocument()
    expect(screen.queryByTestId('person-row-e2')).not.toBeInTheDocument()
  })

  it('also matches on a non-name field (phone), not just the person\'s name', async () => {
    stub()
    const user = userEvent.setup()
    renderDirectory([
      makeEmployee({ id: 'e1', name: 'Asha Rao', phone: '9876500000' }),
      makeEmployee({ id: 'e2', name: 'Bilal Khan', phone: '9111100000' }),
    ])

    await user.type(screen.getByPlaceholderText(/search by name/i), '98765')

    expect(screen.getByTestId('person-row-e1')).toBeInTheDocument()
    expect(screen.queryByTestId('person-row-e2')).not.toBeInTheDocument()
  })
})

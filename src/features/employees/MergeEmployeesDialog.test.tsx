import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { MergeEmployeesDialog } from './MergeEmployeesDialog'
import type { Employee } from '@/lib/types'

// Task 9.1 (Avatar rollout): each of the two "keep as primary" candidate
// cards renders an Avatar for its employee.

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1', code: 'C1', name: 'Jane Roe', designation: 'Officer',
    email: '', phone: '', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: 'node-1', managerId: null, vacant: false, connected: false,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: {}, status: 'active',
    ...overrides,
  }
}

function stubApiHooks() {
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    merge: { mutateAsync: vi.fn(), isPending: false },
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
  vi.spyOn(api, 'useTimeline').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useTimeline>)
  vi.spyOn(api, 'useTransfers').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useTransfers>)
  vi.spyOn(api, 'useDirectReports').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useDirectReports>)
  vi.spyOn(api, 'useDepartments').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useDepartments>)
}

describe('MergeEmployeesDialog — Avatar rollout (Task 9.1)', () => {
  it('renders a photo Avatar for the candidate with a photoUrl and initials for the one without', () => {
    stubApiHooks()
    const a = makeEmployee({ id: 'emp-a', name: 'Jane Roe', photoUrl: 'https://example.com/jane.jpg' })
    const b = makeEmployee({ id: 'emp-b', name: 'John Doe', photoUrl: null })

    render(<MergeEmployeesDialog open onClose={() => {}} employeeA={a} employeeB={b} />)

    const img = screen.getByAltText('Jane Roe')
    expect(img).toHaveAttribute('src', 'https://example.com/jane.jpg')
    expect(screen.getByText('JD')).toBeInTheDocument()
  })
})

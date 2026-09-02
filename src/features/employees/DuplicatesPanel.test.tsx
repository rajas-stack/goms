import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { DuplicatesPanel } from './DuplicatesPanel'
import type { Employee } from '@/lib/types'

// Task 9.1 (Avatar rollout): each duplicate-pair row renders an Avatar per
// side of the pair. Not under test elsewhere (MergeEmployeesDialog and
// EmployeeDetails cover their own call sites) — the Review-merge dialog
// itself is mocked out here since it's a separate call site with its own
// coverage.
vi.mock('./MergeEmployeesDialog', () => ({ MergeEmployeesDialog: () => null }))

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1', code: 'C1', name: 'Priya Nair', designation: 'Officer',
    email: '', phone: '', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: 'node-1', managerId: null, vacant: false, connected: false,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: {}, status: 'active',
    ...overrides,
  }
}

describe('DuplicatesPanel — Avatar rollout (Task 9.1)', () => {
  it('renders a photo Avatar for a duplicate-pair member whose photoUrl is set', () => {
    const a = makeEmployee({ id: 'emp-a', name: 'Priya Nair', photoUrl: 'https://example.com/priya.jpg' })
    const b = makeEmployee({ id: 'emp-b', name: 'Priya Nair', photoUrl: null })
    vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [a, b] } as unknown as ReturnType<typeof api.useAllEmployees>)
    vi.spyOn(api, 'useEmployeeDepartments').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useEmployeeDepartments>)

    render(<DuplicatesPanel open onClose={() => {}} />)

    const img = screen.getByAltText('Priya Nair')
    expect(img).toHaveAttribute('src', 'https://example.com/priya.jpg')
  })
})

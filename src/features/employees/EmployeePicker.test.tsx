import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmployeePicker } from './EmployeePicker'
import type { Employee } from '@/lib/types'

// Task 9.1 (Avatar rollout): both the selected chip and the dropdown rows
// used to render an ad-hoc initials div with no photo support — a real bug
// fix, since a photoUrl'd candidate never showed a picture anywhere in this
// picker. This suite proves both spots now show a photo when photoUrl is
// set, and initials otherwise.

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

describe('EmployeePicker — Avatar rollout (Task 9.1)', () => {
  it('selected chip renders a photo when the selected candidate has a photoUrl', () => {
    const jane = makeEmployee({ photoUrl: 'https://example.com/jane.jpg' })
    render(<EmployeePicker candidates={[jane]} value="emp-1" onChange={() => {}} />)

    const img = screen.getByAltText('Jane Roe')
    expect(img).toHaveAttribute('src', 'https://example.com/jane.jpg')
  })

  it('selected chip renders initials when the selected candidate has no photoUrl', () => {
    const jane = makeEmployee({ photoUrl: null })
    render(<EmployeePicker candidates={[jane]} value="emp-1" onChange={() => {}} />)

    expect(screen.getByText('JR')).toBeInTheDocument()
    expect(screen.queryByAltText('Jane Roe')).not.toBeInTheDocument()
  })

  it('a dropdown row renders a photo for a candidate with a photoUrl', async () => {
    const user = userEvent.setup()
    const jane = makeEmployee({ photoUrl: 'https://example.com/jane.jpg' })
    render(<EmployeePicker candidates={[jane]} value="" onChange={() => {}} />)

    await user.click(screen.getByPlaceholderText('Search a person…'))

    const img = await screen.findByAltText('Jane Roe')
    expect(img).toHaveAttribute('src', 'https://example.com/jane.jpg')
  })

  it('a dropdown row renders initials for a candidate with no photoUrl', async () => {
    const user = userEvent.setup()
    const jane = makeEmployee({ photoUrl: null })
    render(<EmployeePicker candidates={[jane]} value="" onChange={() => {}} />)

    await user.click(screen.getByPlaceholderText('Search a person…'))

    expect(await screen.findByText('JR')).toBeInTheDocument()
    expect(screen.queryByAltText('Jane Roe')).not.toBeInTheDocument()
  })
})

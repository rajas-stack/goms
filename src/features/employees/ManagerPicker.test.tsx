import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ManagerPicker } from './ManagerPicker'
import type { Employee } from '@/lib/types'

// Task 9.1 (Avatar rollout): both the selected chip and the dropdown rows
// used to render an ad-hoc initials div with no photo support — a real bug
// fix, since a photoUrl'd manager never showed a picture. Separately, that
// old ad-hoc initials div used ManagerPicker's own divergent "first two
// words" convention rather than the shared `initials()` helper's "first +
// last word" convention — a real, user-visible behavior change for 3+-word
// names (e.g. "John Michael Smith": old "JM", new "JS") — asserted below.

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

describe('ManagerPicker — Avatar rollout (Task 9.1)', () => {
  it('selected chip renders a photo when the selected candidate has a photoUrl', () => {
    const jane = makeEmployee({ photoUrl: 'https://example.com/jane.jpg' })
    render(<ManagerPicker candidates={[jane]} value="emp-1" onChange={() => {}} onCreate={vi.fn()} />)

    const img = screen.getByAltText('Jane Roe')
    expect(img).toHaveAttribute('src', 'https://example.com/jane.jpg')
  })

  it('selected chip renders initials when the selected candidate has no photoUrl', () => {
    const jane = makeEmployee({ photoUrl: null })
    render(<ManagerPicker candidates={[jane]} value="emp-1" onChange={() => {}} onCreate={vi.fn()} />)

    expect(screen.getByText('JR')).toBeInTheDocument()
    expect(screen.queryByAltText('Jane Roe')).not.toBeInTheDocument()
  })

  it('a dropdown row renders a photo for a candidate with a photoUrl', async () => {
    const user = userEvent.setup()
    const jane = makeEmployee({ photoUrl: 'https://example.com/jane.jpg' })
    render(<ManagerPicker candidates={[jane]} value="" onChange={() => {}} onCreate={vi.fn()} />)

    await user.click(screen.getByPlaceholderText(/search or type/i))

    const img = await screen.findByAltText('Jane Roe')
    expect(img).toHaveAttribute('src', 'https://example.com/jane.jpg')
  })

  it('a dropdown row renders initials for a candidate with no photoUrl', async () => {
    const user = userEvent.setup()
    const jane = makeEmployee({ photoUrl: null })
    render(<ManagerPicker candidates={[jane]} value="" onChange={() => {}} onCreate={vi.fn()} />)

    await user.click(screen.getByPlaceholderText(/search or type/i))

    expect(await screen.findByText('JR')).toBeInTheDocument()
    expect(screen.queryByAltText('Jane Roe')).not.toBeInTheDocument()
  })

  it('follows the shared initials() first+last-word convention, not the old "first two words" one', async () => {
    // Old ManagerPicker-local convention took the first letter of the first
    // two words: "John Michael Smith" -> "JM". The shared `initials()`
    // helper takes first-word-first-letter + last-word-first-letter: "JS".
    // This is the exact behavior change called out in the brief.
    const user = userEvent.setup()
    const john = makeEmployee({ id: 'emp-2', name: 'John Michael Smith', photoUrl: null })
    render(<ManagerPicker candidates={[john]} value="" onChange={() => {}} onCreate={vi.fn()} />)

    await user.click(screen.getByPlaceholderText(/search or type/i))

    expect(await screen.findByText('JS')).toBeInTheDocument()
    expect(screen.queryByText('JM')).not.toBeInTheDocument()
  })

  it('selected chip also follows the first+last-word convention for a 3+-word name', () => {
    const john = makeEmployee({ id: 'emp-2', name: 'John Michael Smith', photoUrl: null })
    render(<ManagerPicker candidates={[john]} value="emp-2" onChange={() => {}} onCreate={vi.fn()} />)

    expect(screen.getByText('JS')).toBeInTheDocument()
    expect(screen.queryByText('JM')).not.toBeInTheDocument()
  })
})

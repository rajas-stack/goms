import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OwnerBadge } from './OwnerBadge'
import type { SalesPerson } from '@/lib/types'

function makeSalesPerson(overrides: Partial<SalesPerson> = {}): SalesPerson {
  return {
    id: 'sp-1', employeeCode: 'E1', name: 'Jane Doe', officialEmail: 'jane@amnex.com',
    personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
    status: 'active', notes: '', metadata: {}, createdAt: '2026-01-01',
    ...overrides,
  } as SalesPerson
}

// Task 9.2: OwnerBadge shows an avatar for both a direct and an
// inherited/ancestor-resolved owner. No photo field exists on SalesPerson, so
// this must always resolve to the initials variant — never attempt an <img>.
describe('OwnerBadge avatar (Task 9.2)', () => {
  it('renders an avatar (initials) for a direct owner', () => {
    const people = [makeSalesPerson()]
    render(
      <OwnerBadge owner={{ salesPersonId: 'sp-1', source: 'direct', depth: 0 }} people={people} />,
    )
    expect(screen.getByTestId('avatar')).toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders an avatar (initials) for an inherited (ancestor-resolved) owner', () => {
    const people = [makeSalesPerson({ id: 'sp-2', name: 'Amit Shah' })]
    render(
      <OwnerBadge
        owner={{ salesPersonId: 'sp-2', source: 'inherited', viaEntityType: 'orgNode', viaEntityId: 'node-1', depth: 1 }}
        people={people}
        viaLabel="Parent Dept"
      />,
    )
    expect(screen.getByTestId('avatar')).toBeInTheDocument()
    expect(screen.getByText('AS')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders no avatar when there is no owner (Unassigned)', () => {
    render(<OwnerBadge owner={null} people={[]} />)
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.queryByTestId('avatar')).not.toBeInTheDocument()
  })

  it('falls back to the raw salesPersonId as the avatar name when the person is not in the list', () => {
    render(
      <OwnerBadge owner={{ salesPersonId: 'sp-missing', source: 'direct', depth: 0 }} people={[]} />,
    )
    expect(screen.getByTestId('avatar')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

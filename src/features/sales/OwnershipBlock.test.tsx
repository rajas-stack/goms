import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { OwnershipBlock } from './OwnershipBlock'
import type { SalesPerson } from '@/lib/types'

// Out of scope for this suite (Task 9.2 is only about the avatar rendering
// on the delegate badge and "Previously" rows) — stubbed so it doesn't need
// its own QueryClientProvider/mutation wiring.
vi.mock('./AssignOwnerDialog', () => ({ AssignOwnerDialog: () => null }))

function makeSalesPerson(overrides: Partial<SalesPerson> = {}): SalesPerson {
  return {
    id: 'sp-1', employeeCode: 'E1', name: 'Jane Doe', officialEmail: 'jane@amnex.com',
    personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
    status: 'active', notes: '', metadata: {}, createdAt: '2026-01-01',
    ...overrides,
  } as SalesPerson
}

// Task 9.2: OwnershipBlock's delegate badge and "Previously" history rows
// each show an avatar alongside the resolved person's name.
describe('OwnershipBlock avatars (Task 9.2)', () => {
  it('shows an avatar next to the active delegate', () => {
    const people = [makeSalesPerson({ id: 'sp-delegate', name: 'Del E. Gate' })]
    vi.spyOn(api, 'useOwnershipFor').mockReturnValue({
      data: [
        { id: 'a1', entityType: 'orgNode', entityId: 'dept-1', salesPersonId: 'sp-delegate', role: 'delegate', startDate: '2020-01-01', endDate: '2099-01-01' },
      ],
    } as unknown as ReturnType<typeof api.useOwnershipFor>)
    vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: people } as unknown as ReturnType<typeof api.useSalesPersons>)

    render(
      <OwnershipBlock
        entityType="orgNode"
        entityId="dept-1"
        entityLabel="Health"
        owner={{ salesPersonId: 'sp-1', source: 'direct', depth: 0 }}
      />,
    )

    expect(screen.getByText(/Del E. Gate · delegate/)).toBeInTheDocument()
    // Two avatars expected: one from OwnerBadge (the owner), one for the delegate.
    expect(screen.getAllByTestId('avatar').length).toBeGreaterThanOrEqual(2)
  })

  it('shows an avatar next to each "Previously" history row', () => {
    const people = [makeSalesPerson({ id: 'sp-past', name: 'Past Owner' })]
    vi.spyOn(api, 'useOwnershipFor').mockReturnValue({
      data: [
        { id: 'a2', entityType: 'orgNode', entityId: 'dept-1', salesPersonId: 'sp-past', role: 'owner', startDate: '2019-01-01', endDate: '2020-01-01' },
      ],
    } as unknown as ReturnType<typeof api.useOwnershipFor>)
    vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: people } as unknown as ReturnType<typeof api.useSalesPersons>)

    render(
      <OwnershipBlock
        entityType="orgNode"
        entityId="dept-1"
        entityLabel="Health"
        owner={null}
      />,
    )

    expect(screen.getByText(/Past Owner/)).toBeInTheDocument()
    expect(screen.getAllByTestId('avatar').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

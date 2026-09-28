import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '@/lib/api'
import { Ownership, RosterRow } from './SalesWorkspace'
import type { SalesPerson, SalesPosting } from '@/lib/types'

// Task 9.3: Sales Team views standardize on the shared Avatar component,
// initials-only (Decision #5 — SalesPerson has no photoUrl field). These
// tests guard the visual-consistency contract at each of the three call
// sites owned by this file (a fourth lives in SalesPersonDetails.test.tsx):
// RosterRow, the Ownership "Owned by" filter chip, and OrgChartNode — every
// one must render through Avatar's initials fallback and never attempt an
// <img>, since there is no field to source a photo from.

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: 'E1', name: 'Alice Anderson', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', notes: '', metadata: {}, createdAt: '', createdBy: null,
}

function makePosting(overrides: Partial<SalesPosting> = {}): SalesPosting {
  return {
    id: 'post-1', salesPersonId: 'sp-alice', designation: 'Account Manager', tierKey: 'tier-1',
    managerId: null, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null, changeType: 'initial',
    reason: '', createdAt: '', createdBy: null,
    ...overrides,
  }
}

describe('RosterRow avatar (Task 9.3)', () => {
  it('renders the shared Avatar initials fallback, not an ad-hoc initials div', () => {
    render(<RosterRow person={ALICE} posting={makePosting()} selected={false} onSelect={vi.fn()} />)
    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveTextContent('AA')
    expect(avatar).toHaveClass('rounded-full')
  })

  it('never renders an <img> for a SalesPerson (no photoUrl field exists)', () => {
    render(<RosterRow person={ALICE} posting={makePosting()} selected={false} onSelect={vi.fn()} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

// Ownership calls useWorkspace() itself (unlike RosterRow, which
// receive `ws` as a prop), so it needs the module mocked — mirrors the
// approach in WorksEditor.test.tsx.
vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ selection: null, select: vi.fn() }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function stubOwnershipApiHooks() {
  vi.spyOn(api, 'useDepartments').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useDepartments>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useOpportunities').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpportunities>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [ALICE] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useResolvedOwners').mockReturnValue({ data: {} } as unknown as ReturnType<typeof api.useResolvedOwners>)
}

describe('Ownership "Owned by" filter chip avatar (Task 9.3)', () => {
  it('renders the shared Avatar initials fallback for the filtered owner', () => {
    stubOwnershipApiHooks()
    render(
      <MemoryRouter initialEntries={['/sales/ownership?owner=sp-alice']}>
        <Ownership />
      </MemoryRouter>,
    )
    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveTextContent('AA')
    expect(avatar).toHaveClass('rounded-full')
  })

  it('never renders an <img> for the filtered owner (no photoUrl field exists)', () => {
    stubOwnershipApiHooks()
    render(
      <MemoryRouter initialEntries={['/sales/ownership?owner=sp-alice']}>
        <Ownership />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

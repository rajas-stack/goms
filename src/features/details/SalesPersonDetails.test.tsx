import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { SalesPersonDetails } from './SalesPersonDetails'
import type { SalesPerson } from '@/lib/types'

// Task 9.3: the header here is the fourth (and last) Sales Team call site
// standardizing on the shared Avatar component, initials-only (Decision #5
// — SalesPerson has no photoUrl field). Sibling call sites (RosterRow, the
// Ownership "Owned by" chip, OrgChartNode) are covered in
// src/app/routes/SalesWorkspace.test.tsx.

// None of these dialogs are under test here (this suite is about the header
// avatar, not the edit/transfer/delete flows) and each calls its own
// data-mutation hooks unconditionally regardless of `open` — replaced with
// inert stubs, mirroring EmployeeFormDialog.test.tsx's approach to
// SalesTeamPicker/ManagerPicker.
vi.mock('@/features/sales/SalesPersonFormDialog', () => ({ SalesPersonFormDialog: () => null }))
vi.mock('@/features/sales/TransferSalesPersonDialog', () => ({ TransferSalesPersonDialog: () => null }))
vi.mock('@/features/sales/TransferBookOfBusinessDialog', () => ({ TransferBookOfBusinessDialog: () => null }))

vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ selection: null, select: vi.fn(), clearSelection: vi.fn() }),
}))

vi.mock('@/features/sales/salesEditLock', () => ({
  useSalesEditLock: () => ({ unlocked: false, toggle: vi.fn() }),
}))

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: 'E1', name: 'Alice Anderson', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', notes: '', metadata: {}, createdAt: '', createdBy: null,
}

function stubApiHooks() {
  vi.spyOn(api, 'useSalesPerson').mockReturnValue({ data: ALICE } as unknown as ReturnType<typeof api.useSalesPerson>)
  vi.spyOn(api, 'useSalesPostings').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useSalesPostings>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [ALICE] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useOwnedBy').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOwnedBy>)
  vi.spyOn(api, 'useDepartments').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useDepartments>)
  vi.spyOn(api, 'useAllEmployees').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useAllEmployees>)
  vi.spyOn(api, 'useOpportunities').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useOpportunities>)
  vi.spyOn(api, 'useSalesPersonMutations').mockReturnValue({
    setStatus: { mutateAsync: vi.fn() },
    remove: { mutateAsync: vi.fn() },
  } as unknown as ReturnType<typeof api.useSalesPersonMutations>)
}

describe('SalesPersonDetails header avatar (Task 9.3)', () => {
  it('renders the shared Avatar initials fallback, not an ad-hoc initials div', () => {
    stubApiHooks()
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveTextContent('AA')
    expect(avatar).toHaveClass('rounded-full')
  })

  it('never renders an <img> for a SalesPerson (no photoUrl field exists)', () => {
    stubApiHooks()
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

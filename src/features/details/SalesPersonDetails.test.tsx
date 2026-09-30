import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { SalesPersonDetails } from './SalesPersonDetails'
import type { SalesPerson, SalesPosting } from '@/lib/types'

// Task 9.3: the header here is the fourth (and last) Sales Team call site
// standardizing on the shared Avatar component. Sibling call sites
// (RosterRow, the Ownership "Owned by" chip, OrgChartNode) are covered in
// src/app/routes/SalesWorkspace.test.tsx.

// None of these dialogs are under test here (this suite is about the header
// avatar, not the edit/transfer/delete flows) and each calls its own
// data-mutation hooks unconditionally regardless of `open` — replaced with
// inert stubs, mirroring EmployeeFormDialog.test.tsx's approach to
// SalesTeamPicker/ManagerPicker.
vi.mock('@/features/sales/SalesPersonFormDialog', () => ({ SalesPersonFormDialog: () => null }))
vi.mock('@/features/sales/TransferSalesPersonDialog', () => ({ TransferSalesPersonDialog: () => null }))
vi.mock('@/features/sales/TransferBookOfBusinessDialog', () => ({ TransferBookOfBusinessDialog: () => null }))
vi.mock('@/features/sales/EditPostingDatesDialog', () => ({ EditPostingDatesDialog: () => null }))

vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ selection: null, select: vi.fn(), clearSelection: vi.fn() }),
}))

vi.mock('@/features/sales/salesEditLock', () => ({
  useSalesEditLock: () => ({ unlocked: false, toggle: vi.fn() }),
}))

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: 'E1', name: 'Alice Anderson', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
}

function stubApiHooks(opts: { postings?: SalesPosting[]; people?: SalesPerson[]; currentPostings?: Record<string, SalesPosting> } = {}) {
  vi.spyOn(api, 'useSalesPerson').mockReturnValue({ data: ALICE } as unknown as ReturnType<typeof api.useSalesPerson>)
  vi.spyOn(api, 'useSalesPostings').mockReturnValue({ data: opts.postings ?? [] } as unknown as ReturnType<typeof api.useSalesPostings>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: opts.people ?? [ALICE] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue({ data: opts.currentPostings ?? {} } as unknown as ReturnType<typeof api.useCurrentPostings>)
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

  it('falls back to initials when photoUrl is unset', () => {
    stubApiHooks()
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders the photo as an image when photoUrl is set', () => {
    stubApiHooks({ people: [{ ...ALICE, photoUrl: 'data:image/png;base64,AAA=' }] })
    vi.spyOn(api, 'useSalesPerson').mockReturnValue({
      data: { ...ALICE, photoUrl: 'data:image/png;base64,AAA=' },
    } as unknown as ReturnType<typeof api.useSalesPerson>)
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
  })
})

// Item 1: "salesperson details" previously showed only Reporting manager
// (RM) — GM/Higher Reporting Manager never appeared here at all.
describe('SalesPersonDetails — GM / Higher Reporting Manager row (item 1)', () => {
  const BOB: SalesPerson = { ...ALICE, id: 'sp-bob', name: 'Bob Reports', officialEmail: 'bob@amnex.com' }
  const CAROL: SalesPerson = { ...ALICE, id: 'sp-carol', name: 'Carol GM', officialEmail: 'carol@amnex.com' }

  function posting(overrides: Partial<SalesPosting> = {}): SalesPosting {
    return {
      id: 'post-1', salesPersonId: 'sp-alice', designation: 'Account Manager', tierKey: 'accountManager',
      managerId: null, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null, changeType: 'initial',
      reason: '', createdAt: '', createdBy: null,
      ...overrides,
    }
  }

  it('shows the auto-derived GM (one level up the RM chain) when no override is set', () => {
    stubApiHooks({
      people: [ALICE, BOB, CAROL],
      postings: [posting({ managerId: 'sp-bob' })],
      currentPostings: {
        'sp-alice': posting({ managerId: 'sp-bob' }),
        'sp-bob': posting({ id: 'post-bob', salesPersonId: 'sp-bob', managerId: 'sp-carol', designation: 'Regional Manager' }),
        'sp-carol': posting({ id: 'post-carol', salesPersonId: 'sp-carol', managerId: null, designation: 'Regional Head' }),
      },
    })
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    expect(screen.getAllByText('Carol GM').length).toBeGreaterThan(0)
  })

  it('shows the explicit gmOverrideId instead of the derived value when one is set', () => {
    stubApiHooks({
      people: [ALICE, BOB, CAROL],
      postings: [posting({ managerId: 'sp-bob', gmOverrideId: 'sp-alice' })],
      currentPostings: {
        'sp-alice': posting({ managerId: 'sp-bob', gmOverrideId: 'sp-alice' }),
        'sp-bob': posting({ id: 'post-bob', salesPersonId: 'sp-bob', managerId: 'sp-carol', designation: 'Regional Manager' }),
      },
    })
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    // Derived would be Carol; the override picks Alice herself instead.
    expect(screen.queryAllByText('Carol GM')).toHaveLength(0)
    expect(screen.getAllByText(/^Alice Anderson$/).length).toBeGreaterThan(0)
  })
})

// Posting section: dates are editable (behind the edit lock, like every other
// edit here), including for an ENDED posting so it can be corrected/reopened.
describe('SalesPersonDetails — Edit dates action', () => {
  const posting = (o: Partial<SalesPosting> = {}): SalesPosting => ({
    id: 'post-1', salesPersonId: 'sp-alice', designation: 'Account Manager', tierKey: 'accountManager',
    managerId: null, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null, changeType: 'initial',
    reason: '', createdAt: '', createdBy: null, ...o,
  })

  it('offers Edit dates on the Posting section, disabled while editing is locked', () => {
    stubApiHooks({ postings: [posting()] })
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    expect(screen.getByRole('button', { name: /edit dates/i })).toBeDisabled()
  })

  it('still offers Edit dates when the only posting has ended, and says when it ended', () => {
    stubApiHooks({ postings: [posting({ endDate: '2026-04-01' })] })
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    expect(screen.getByRole('button', { name: /edit dates/i })).toBeInTheDocument()
    expect(screen.getByText(/no current posting\. the latest posting ended 2026-03-31/i)).toBeInTheDocument()
  })

  it('does not offer Edit dates when the person has no postings at all', () => {
    stubApiHooks({ postings: [] })
    render(<SalesPersonDetails salesPersonId="sp-alice" />)
    expect(screen.queryByRole('button', { name: /edit dates/i })).not.toBeInTheDocument()
  })
})

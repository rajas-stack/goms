import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '@/lib/api'
import { SalesPersonFormDialog } from './SalesPersonFormDialog'
import type { SalesPerson, SalesPosting } from '@/lib/types'

// The picker's own popover/typeahead mechanics are unrelated to what this
// file tests (the dialog's editable-RM/derived-GM wiring and submit()), and
// are otherwise hard to drive headlessly. Replaced with a bare controlled
// <input> so a test can set the RM/GM fields directly via the Field's
// wrapping <label> — same approach as EmployeeFormDialog.test.tsx.
vi.mock('@/features/employees/SalesTeamPicker', () => ({
  SalesTeamPicker: ({ value, onChange, disabled }: { value: string; onChange: (email: string) => void; disabled?: boolean }) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
  ),
}))

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: 'E1', name: 'Alice', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', notes: '', metadata: {}, createdAt: '', createdBy: null,
}
const BOB: SalesPerson = { ...ALICE, id: 'sp-bob', name: 'Bob', officialEmail: 'bob@amnex.com' }
const CAROL: SalesPerson = { ...ALICE, id: 'sp-carol', name: 'Carol', officialEmail: 'carol@amnex.com' }
const REPORT: SalesPerson = { ...ALICE, id: 'sp-report', name: 'Report Person', officialEmail: 'report@amnex.com' }

function makePosting(overrides: Partial<SalesPosting> = {}): SalesPosting {
  return {
    id: 'post-1', salesPersonId: 'sp-report', designation: 'Account Manager', tierKey: 'accountManager',
    managerId: null, office: '', startDate: '2024-01-01', endDate: null, changeType: 'initial',
    reason: '', createdAt: '', createdBy: null,
    ...overrides,
  }
}

const updateMutateAsync = vi.fn()
const updatePostingManagerMutateAsync = vi.fn()

function stubApiHooks(opts: { currentPostings?: Record<string, SalesPosting> } = {}) {
  vi.spyOn(api, 'useSalesPersons').mockReturnValue(
    { data: [ALICE, BOB, CAROL, REPORT] } as unknown as ReturnType<typeof api.useSalesPersons>,
  )
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue(
    { data: opts.currentPostings ?? {} } as unknown as ReturnType<typeof api.useCurrentPostings>,
  )
  vi.spyOn(api, 'useSalesPersonMutations').mockReturnValue({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: updateMutateAsync, isPending: false },
    setStatus: {},
    remove: {},
    transfer: {},
    updatePostingManager: { mutateAsync: updatePostingManagerMutateAsync, isPending: false },
  } as unknown as ReturnType<typeof api.useSalesPersonMutations>)
}

function renderDialog(personId: string | null) {
  const qc = new QueryClient()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <SalesPersonFormDialog open personId={personId} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

beforeEach(() => {
  updateMutateAsync.mockReset().mockResolvedValue(undefined)
  updatePostingManagerMutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SalesPersonFormDialog — editable RM + derived-disabled GM (task 6.3)', () => {
  it('editing shows an editable RM picker and a disabled, auto-derived GM field instead of hiding them', () => {
    stubApiHooks({ currentPostings: { 'sp-report': makePosting({ managerId: 'sp-alice' }) } })
    renderDialog('sp-report')

    const rmField = screen.getByLabelText(/reporting manager \(rm\)/i)
    expect(rmField).not.toBeDisabled()
    expect(rmField).toHaveValue('alice@amnex.com')

    const gmField = screen.getByLabelText(/gm \/ higher reporting manager/i)
    expect(gmField).toBeDisabled()

    // Neither Designation nor Tier nor "Reports to" (the create-only fields)
    // should be shown while editing — this replaces that hidden block, it
    // doesn't add alongside it.
    expect(screen.queryByLabelText(/^designation/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^tier$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^reports to$/i)).not.toBeInTheDocument()
  })

  it('creating (no personId) still shows Designation/Tier/Reports to, not the RM/GM fields', () => {
    stubApiHooks()
    renderDialog(null)

    expect(screen.getByLabelText(/^designation/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^tier$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^reports to$/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/reporting manager \(rm\)/i)).not.toBeInTheDocument()
  })

  it('picking a new RM and saving calls updatePostingManager with the resolved person id', async () => {
    stubApiHooks({ currentPostings: { 'sp-report': makePosting({ managerId: 'sp-alice' }) } })
    const user = userEvent.setup()
    renderDialog('sp-report')

    const rmField = screen.getByLabelText(/reporting manager \(rm\)/i)
    await user.clear(rmField)
    await user.type(rmField, 'bob@amnex.com')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(updatePostingManagerMutateAsync).toHaveBeenCalledWith({
      personId: 'sp-report', managerId: 'sp-bob',
    }))
  })

  it('saving WITHOUT changing the RM does not call updatePostingManager', async () => {
    stubApiHooks({ currentPostings: { 'sp-report': makePosting({ managerId: 'sp-alice' }) } })
    const user = userEvent.setup()
    renderDialog('sp-report')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled())
    expect(updatePostingManagerMutateAsync).not.toHaveBeenCalled()
  })

  it('the GM field updates locally when a different RM is picked, before saving', async () => {
    // Bob reports to Carol — so picking Bob as RM should derive Carol as GM,
    // reflected immediately from local state, before any mutation round-trips.
    stubApiHooks({
      currentPostings: {
        'sp-report': makePosting({ managerId: 'sp-alice' }),
        'sp-bob': makePosting({ id: 'post-bob', salesPersonId: 'sp-bob', managerId: 'sp-carol', designation: 'Regional Manager' }),
        'sp-carol': makePosting({ id: 'post-carol', salesPersonId: 'sp-carol', managerId: null, designation: 'Regional Head' }),
      },
    })
    const user = userEvent.setup()
    renderDialog('sp-report')

    const rmField = screen.getByLabelText(/reporting manager \(rm\)/i)
    const gmField = screen.getByLabelText(/gm \/ higher reporting manager/i)
    expect(gmField).toHaveValue('')

    await user.clear(rmField)
    await user.type(rmField, 'bob@amnex.com')

    await waitFor(() => expect(gmField).toHaveValue('carol@amnex.com'))
    // No mutation was called yet — this is purely local derived state.
    expect(updatePostingManagerMutateAsync).not.toHaveBeenCalled()
  })

  it('setting RM back to "no manager" (empty) calls updatePostingManager with managerId: null', async () => {
    stubApiHooks({ currentPostings: { 'sp-report': makePosting({ managerId: 'sp-alice' }) } })
    const user = userEvent.setup()
    renderDialog('sp-report')

    const rmField = screen.getByLabelText(/reporting manager \(rm\)/i)
    await user.clear(rmField)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updatePostingManagerMutateAsync).toHaveBeenCalledWith({
      personId: 'sp-report', managerId: null,
    }))
  })
})

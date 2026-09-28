import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '@/lib/api'
import { SalesPersonFormDialog } from './SalesPersonFormDialog'
import { repository, resetLocalData } from '@/data/repository'
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
  status: 'active', photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
}
const BOB: SalesPerson = { ...ALICE, id: 'sp-bob', name: 'Bob', officialEmail: 'bob@amnex.com' }
const CAROL: SalesPerson = { ...ALICE, id: 'sp-carol', name: 'Carol', officialEmail: 'carol@amnex.com' }
const REPORT: SalesPerson = { ...ALICE, id: 'sp-report', name: 'Report Person', officialEmail: 'report@amnex.com' }

function makePosting(overrides: Partial<SalesPosting> = {}): SalesPosting {
  return {
    id: 'post-1', salesPersonId: 'sp-report', designation: 'Account Manager', tierKey: 'accountManager',
    managerId: null, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null, changeType: 'initial',
    reason: '', createdAt: '', createdBy: null,
    ...overrides,
  }
}

const createMutateAsync = vi.fn()
const updateMutateAsync = vi.fn()
const updatePostingManagerMutateAsync = vi.fn()

function stubApiHooks(opts: { currentPostings?: Record<string, SalesPosting>; people?: SalesPerson[] } = {}) {
  vi.spyOn(api, 'useSalesPersons').mockReturnValue(
    { data: opts.people ?? [ALICE, BOB, CAROL, REPORT] } as unknown as ReturnType<typeof api.useSalesPersons>,
  )
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue(
    { data: opts.currentPostings ?? {} } as unknown as ReturnType<typeof api.useCurrentPostings>,
  )
  vi.spyOn(api, 'useSalesPersonMutations').mockReturnValue({
    create: { mutateAsync: createMutateAsync, isPending: false },
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
  createMutateAsync.mockReset().mockResolvedValue(undefined)
  updateMutateAsync.mockReset().mockResolvedValue(undefined)
  updatePostingManagerMutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SalesPersonFormDialog — editable RM + independently editable GM (item 1)', () => {
  it('editing shows an editable RM picker and an editable, auto-derived-by-default GM field instead of hiding them', () => {
    stubApiHooks({ currentPostings: { 'sp-report': makePosting({ managerId: 'sp-alice' }) } })
    renderDialog('sp-report')

    const rmField = screen.getByLabelText(/reporting manager \(rm\)/i)
    expect(rmField).not.toBeDisabled()
    expect(rmField).toHaveValue('alice@amnex.com')

    const gmField = screen.getByLabelText(/gm \/ higher reporting manager/i)
    expect(gmField).not.toBeDisabled()

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

  it('picking an explicit GM override and saving calls updatePostingManager with gmOverrideId, and RM is omitted since it did not change', async () => {
    stubApiHooks({ currentPostings: { 'sp-report': makePosting({ managerId: 'sp-alice' }) } })
    const user = userEvent.setup()
    renderDialog('sp-report')

    const gmField = screen.getByLabelText(/gm \/ higher reporting manager/i)
    await user.clear(gmField)
    await user.type(gmField, 'carol@amnex.com')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updatePostingManagerMutateAsync).toHaveBeenCalledWith({
      personId: 'sp-report', gmOverrideId: 'sp-carol',
    }))
  })

  it('an existing GM override pre-fills the field, and clearing it back to blank reverts to auto-derive (gmOverrideId: null)', async () => {
    stubApiHooks({
      currentPostings: {
        'sp-report': makePosting({ managerId: 'sp-alice', gmOverrideId: 'sp-carol' }),
      },
    })
    const user = userEvent.setup()
    renderDialog('sp-report')

    const gmField = screen.getByLabelText(/gm \/ higher reporting manager/i)
    expect(gmField).toHaveValue('carol@amnex.com')

    await user.clear(gmField)
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updatePostingManagerMutateAsync).toHaveBeenCalledWith({
      personId: 'sp-report', gmOverrideId: null,
    }))
  })

  it('saving WITHOUT changing an existing GM override does not call updatePostingManager', async () => {
    stubApiHooks({
      currentPostings: {
        'sp-report': makePosting({ managerId: 'sp-alice', gmOverrideId: 'sp-carol' }),
      },
    })
    const user = userEvent.setup()
    renderDialog('sp-report')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled())
    expect(updatePostingManagerMutateAsync).not.toHaveBeenCalled()
  })
})

describe('SalesPersonFormDialog save path — Org Chart invalidation proof (fix round 6.3 review)', () => {
  // OrgChart (src/app/routes/SalesWorkspace.tsx) reads only `useSalesPersons()`
  // and `useCurrentPostings()` — keyed ['salesPersons'] and
  // ['currentPostings'] — to build its manager/report tree from
  // `postings[personId].managerId`. `OrgChart` itself isn't exported (only
  // `OrgChartNode` is, for a narrower avatar test in SalesWorkspace.test.tsx),
  // and mounting it alongside this dialog would mean duplicating a large
  // slice of SalesWorkspaceBody's routing/provider setup for no extra proof:
  // TanStack Query re-runs every consumer of an invalidated key on its next
  // render, so once we show this dialog's REAL (unmocked) save path calls the
  // real `updatePostingManager` mutation and that invalidates exactly the
  // four keys OrgChart (and the posting-detail views) read from, OrgChart is
  // guaranteed to pick up the change — it has no other way to observe stale
  // data once those keys are invalidated. This test therefore does not stub
  // `useSalesPersons`/`useCurrentPostings`/`useSalesPersonMutations` at all
  // (unlike every other test in this file) — it runs the dialog against the
  // real in-memory repository, the same one `useSalesPersonMutations.test.tsx`
  // uses to prove `updatePostingManager`'s own invalidation list.
  it('a real RM save invalidates salesPersons/salesPerson/salesPostings/currentPostings — the exact keys OrgChart reads', async () => {
    await resetLocalData()
    const manager = await repository.createSalesPerson({
      name: 'New Manager 6.3', officialEmail: 'new-manager-6.3@example.com', designation: 'RM', tierKey: 'rm',
    })
    const person = await repository.createSalesPerson({
      name: 'Edited Person 6.3', officialEmail: 'edited-person-6.3@example.com', designation: 'Account Manager', tierKey: 'accountManager',
    })

    const qc = new QueryClient()
    // Pre-warm the cache the same way SalesWorkspaceBody already has these
    // queries resident by the time a user opens this dialog — avoids racing
    // the dialog's mount-time effect against the initial fetch.
    qc.setQueryData(['salesPersons'], await repository.listSalesPersons())
    qc.setQueryData(['currentPostings'], await repository.currentPostings())
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={qc}>
        <SalesPersonFormDialog open personId={person.id} onClose={onClose} />
      </QueryClientProvider>,
    )

    const rmField = screen.getByLabelText(/reporting manager \(rm\)/i)
    await user.clear(rmField)
    await user.type(rmField, manager.officialEmail)
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0])
    expect(invalidatedKeys).toEqual(expect.arrayContaining(['salesPersons', 'salesPerson', 'salesPostings', 'currentPostings']))

    // And the underlying data OrgChart would read on its next render really
    // did change, not just the invalidation signal.
    const updatedPosting = (await repository.currentPostings())[person.id]
    expect(updatedPosting.managerId).toBe(manager.id)
  })
})

describe('SalesPersonFormDialog — profile picture', () => {
  it('pasting an image/png clipboard item into the photo area shows it and includes it in the create payload', async () => {
    stubApiHooks()
    renderDialog(null)

    const dataUrl = 'data:image/png;base64,PASTED=='
    class FakeFileReader {
      result: string | ArrayBuffer | null = null
      onload: (() => void) | null = null
      readAsDataURL() {
        this.result = dataUrl
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader as unknown as typeof FileReader)

    const file = new File(['(binary)'], 'pasted.png', { type: 'image/png' })
    const clipboardData = { items: [{ type: 'image/png', getAsFile: () => file }] }
    const dropZone = screen.getByText('Profile Picture').closest('label')!.querySelector('div')!
    act(() => {
      dropZone.dispatchEvent(Object.assign(new Event('paste', { bubbles: true }), { clipboardData }))
    })
    await waitFor(() => expect(screen.getByAltText('')).toHaveAttribute('src', dataUrl))

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Full name'), 'New Person')
    await user.type(screen.getByPlaceholderText('name@amnex.com'), 'new@amnex.com')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ photoUrl: dataUrl }),
    ))
  })

  it('editing a person with an existing photoUrl shows it, and clicking remove clears the update payload field', async () => {
    const existingPhoto = 'data:image/png;base64,EXISTING=='
    stubApiHooks({ people: [ALICE, BOB, CAROL, { ...REPORT, photoUrl: existingPhoto }] })
    renderDialog('sp-report')

    expect(screen.getByAltText('')).toHaveAttribute('src', existingPhoto)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove profile picture' }))
    expect(screen.queryByAltText('')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ photoUrl: null }) }),
    ))
  })
})

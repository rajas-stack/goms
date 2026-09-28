import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { WorksEditor } from './WorksEditor'
import type { Opportunity, SalesPerson } from '@/lib/types'

// The real WorkspaceProvider drags in routing + every workspace dialog; none
// of that is under test here (this suite is about WorksEditor's save()
// wiring to the ownership ledger), so it's replaced with the minimal shape
// WorksEditor reads — mirrors HierarchyCanvas.test.tsx's approach.
vi.mock('@/features/workspace/context', () => ({
  useWorkspace: () => ({ select: vi.fn() }),
}))

// WorkFormDialog's own field mechanics (pickers, draft persistence, date
// inputs) are unrelated to what this suite tests — only the `onSave(draft)`
// call matters here, so it's replaced with two buttons that invoke `onSave`
// with a controllable `salesPersonEmail`, standing in for "user picked a new
// Sales Person and hit Save" vs. "user hit Save without changing it".
vi.mock('./WorkFormDialog', () => ({
  WorkFormDialog: ({ open, work, onSave }: {
    open: boolean
    work: Opportunity | null
    onSave: (draft: Omit<Opportunity, 'id' | 'departmentId' | 'stateCode' | 'createdAt' | 'createdBy'>) => void
  }) => {
    if (!open) return null
    const base: Omit<Opportunity, 'id' | 'departmentId' | 'stateCode' | 'createdAt' | 'createdBy'> = work
      ? { ...work }
      : {
        opportunityName: 'New Opp', gemTenderId: '', publishDate: '', submissionDate: '',
        vertical: '', component: [], quantity: '', currency: 'INR', valueAmount: '', valueUnit: 'lakh',
        budgetKnown: '', emdAmount: '', emdUnit: 'lakh', salesPersonEmail: '',
        stageKey: 'lead', closedOn: null,
      }
    return (
      <div data-testid="work-form-dialog">
        <button onClick={() => onSave({ ...base, salesPersonEmail: 'bob@amnex.com' })}>Save (pick Bob)</button>
        <button onClick={() => onSave(base)}>Save (unchanged)</button>
      </div>
    )
  },
}))

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: 'E1', name: 'Alice', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
}
const BOB: SalesPerson = { ...ALICE, id: 'sp-bob', name: 'Bob', officialEmail: 'bob@amnex.com' }

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1', departmentId: 'dept-1', stateCode: 5, createdAt: '', createdBy: null,
    opportunityName: 'Test Opportunity', gemTenderId: '', publishDate: '', submissionDate: '',
    vertical: '', component: [], quantity: '', currency: 'INR', valueAmount: '', valueUnit: 'lakh',
    budgetKnown: '', emdAmount: '', emdUnit: 'lakh', salesPersonEmail: 'alice@amnex.com',
    stageKey: 'lead', closedOn: null,
    ...overrides,
  }
}

const createMutateAsync = vi.fn()
const updateMutateAsync = vi.fn().mockResolvedValue(undefined)
const removeMutateAsync = vi.fn()
const assignMutateAsync = vi.fn().mockResolvedValue(undefined)

function stubApiHooks(opts: {
  resolvedOwners?: Record<string, { salesPersonId: string; source: 'direct' | 'inherited' }>
} = {}) {
  vi.spyOn(api, 'useOpportunityMutations').mockReturnValue({
    create: { mutate: vi.fn(), mutateAsync: createMutateAsync, isPending: false },
    update: { mutate: vi.fn(), mutateAsync: updateMutateAsync, isPending: false },
    remove: { mutate: vi.fn(), mutateAsync: removeMutateAsync, isPending: false },
  } as unknown as ReturnType<typeof api.useOpportunityMutations>)
  vi.spyOn(api, 'useOwnershipMutations').mockReturnValue({
    assign: { mutateAsync: assignMutateAsync, isPending: false },
    end: {},
    transferBookOfBusiness: {},
  } as unknown as ReturnType<typeof api.useOwnershipMutations>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [ALICE, BOB] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useResolvedOwners').mockReturnValue(
    { data: opts.resolvedOwners ?? {} } as unknown as ReturnType<typeof api.useResolvedOwners>,
  )
}

beforeEach(() => {
  createMutateAsync.mockClear()
  updateMutateAsync.mockClear()
  removeMutateAsync.mockClear()
  assignMutateAsync.mockClear()
})

describe('WorksEditor — auto-reflecting Edit Opportunity\'s Sales Person pick into ownership assignment (item 10)', () => {
  it('saving Edit Opportunity with a newly-picked Sales Person calls assign with the resolved salesPersonId', async () => {
    stubApiHooks({ resolvedOwners: { 'opp-1': { salesPersonId: 'sp-alice', source: 'direct' } } })
    const opp = makeOpportunity()
    const user = userEvent.setup()
    render(<WorksEditor departmentId="dept-1" opportunities={[opp]} />)

    await user.click(screen.getByLabelText('Edit opportunity'))
    await user.click(screen.getByRole('button', { name: 'Save (pick Bob)' }))

    expect(updateMutateAsync).toHaveBeenCalledWith({ id: 'opp-1', patch: expect.objectContaining({ salesPersonEmail: 'bob@amnex.com' }) })
    expect(assignMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'opportunity', entityId: 'opp-1', salesPersonId: 'sp-bob', role: 'owner',
    }))
  })

  it('saving without changing the Sales Person is a no-op on the ownership side', async () => {
    stubApiHooks({ resolvedOwners: { 'opp-1': { salesPersonId: 'sp-alice', source: 'direct' } } })
    const opp = makeOpportunity({ salesPersonEmail: 'alice@amnex.com' })
    const user = userEvent.setup()
    render(<WorksEditor departmentId="dept-1" opportunities={[opp]} />)

    await user.click(screen.getByLabelText('Edit opportunity'))
    await user.click(screen.getByRole('button', { name: 'Save (unchanged)' }))

    expect(updateMutateAsync).toHaveBeenCalled()
    expect(assignMutateAsync).not.toHaveBeenCalled()
  })

  it('an inherited (not direct) resolution does not suppress a genuine new direct assignment', async () => {
    stubApiHooks({ resolvedOwners: { 'opp-1': { salesPersonId: 'sp-bob', source: 'inherited' } } })
    const opp = makeOpportunity({ salesPersonEmail: 'alice@amnex.com' })
    const user = userEvent.setup()
    render(<WorksEditor departmentId="dept-1" opportunities={[opp]} />)

    await user.click(screen.getByLabelText('Edit opportunity'))
    // Picks Bob, who happens to already be the *inherited* resolution — per
    // the ruling this must still create a real direct assignment, not be
    // swallowed as "already the owner".
    await user.click(screen.getByRole('button', { name: 'Save (pick Bob)' }))

    expect(assignMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ salesPersonId: 'sp-bob' }))
  })

  it('the standalone Assign/Reassign button still opens AssignOwnerDialog untouched', async () => {
    stubApiHooks({ resolvedOwners: {} })
    const opp = makeOpportunity()
    const user = userEvent.setup()
    render(<WorksEditor departmentId="dept-1" opportunities={[opp]} />)

    // Expand the row to reveal the AMNEX ownership footer.
    await user.click(screen.getByText('Test Opportunity'))
    await user.click(screen.getByRole('button', { name: 'Assign' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Test Opportunity/)).toBeInTheDocument()
    // The quick Edit-Opportunity save path was never engaged by this flow.
    expect(assignMutateAsync).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { EditPostingDatesDialog } from './EditPostingDatesDialog'
import type { SalesPerson, SalesPosting } from '@/lib/types'

const PERSON: SalesPerson = {
  id: 'sp-1', employeeCode: 'E1', name: 'Alice Anderson', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
}
const OPEN: SalesPosting = {
  id: 'post-1', salesPersonId: 'sp-1', designation: 'Account Manager', tierKey: 'accountManager',
  managerId: null, gmOverrideId: null, office: '', startDate: '1970-01-01', endDate: null, changeType: 'initial',
  reason: '', createdAt: '', createdBy: null,
}
// Stored end is EXCLUSIVE: 2026-04-01 means the last day held was 2026-03-31.
const CLOSED: SalesPosting = { ...OPEN, startDate: '2025-07-01', endDate: '2026-04-01' }

const mutateAsync = vi.fn()

function renderDialog(posting: SalesPosting) {
  vi.spyOn(api, 'useSalesPersonMutations').mockReturnValue({
    updatePostingDates: { mutateAsync, isPending: false },
  } as unknown as ReturnType<typeof api.useSalesPersonMutations>)
  const onClose = vi.fn()
  render(<EditPostingDatesDialog open person={PERSON} posting={posting} onClose={onClose} />)
  return { onClose, user: userEvent.setup() }
}

const from = () => screen.getByLabelText(/effective from/i)
const to = () => screen.getByLabelText(/effective to/i)

beforeEach(() => { mutateAsync.mockReset().mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('EditPostingDatesDialog', () => {
  it('prefills the current posting: Effective to is blank (Present)', () => {
    renderDialog(OPEN)
    expect(from()).toHaveValue('1970-01-01')
    expect(to()).toHaveValue('')
  })

  it('shows the LAST DAY HELD for a closed posting, not the exclusive stored end', () => {
    renderDialog(CLOSED)
    expect(from()).toHaveValue('2025-07-01')
    expect(to()).toHaveValue('2026-03-31')
  })

  it('changing only Effective from sends only startDate', async () => {
    const { user, onClose } = renderDialog(OPEN)
    await user.clear(from())
    await user.type(from(), '2021-04-01')
    await user.click(screen.getByRole('button', { name: 'Save dates' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ postingId: 'post-1', startDate: '2021-04-01' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('setting Effective to on the current posting warns that it ends the posting, and the button says so', async () => {
    const { user } = renderDialog(OPEN)
    await user.type(to(), '2026-03-31')
    expect(screen.getByRole('status')).toHaveTextContent(/ends the posting.*no current posting/i)
    await user.click(screen.getByRole('button', { name: 'End posting & save' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ postingId: 'post-1', lastDayHeld: '2026-03-31' }))
  })

  it('clearing Effective to on an ended posting says it reopens, and sends lastDayHeld: null', async () => {
    const { user } = renderDialog(CLOSED)
    await user.clear(to())
    expect(screen.getByRole('status')).toHaveTextContent(/reopens this posting/i)
    await user.click(screen.getByRole('button', { name: 'Save dates' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ postingId: 'post-1', lastDayHeld: null }))
  })

  it('shows the server reason and stays open when the dates are rejected', async () => {
    mutateAsync.mockRejectedValue(new Error("Effective from must be after the previous posting's start (2024-01-01)."))
    const { user, onClose } = renderDialog(OPEN)
    await user.clear(from())
    await user.type(from(), '2023-01-01')
    await user.click(screen.getByRole('button', { name: 'Save dates' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/after the previous posting's start/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('saving with nothing changed just closes, without a request', async () => {
    const { user, onClose } = renderDialog(OPEN)
    await user.click(screen.getByRole('button', { name: 'Save dates' }))
    expect(onClose).toHaveBeenCalled()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('cannot save with Effective from cleared', async () => {
    const { user } = renderDialog(OPEN)
    await user.clear(from())
    expect(screen.getByRole('button', { name: 'Save dates' })).toBeDisabled()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { ProtectedValuesTab } from './ProtectedValuesTab'

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', submissionDate: '2099-01-15', valueAmount: '5' })
  return repository.createBid(opp.id)
}
function renderTab(bidId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><ProtectedValuesTab bidId={bidId} /></QueryClientProvider>)
}
const row = (label: string) => screen.getAllByTestId('protected-row').find((r) => r.textContent?.includes(label))!

describe('ProtectedValuesTab', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('lists exactly the fields the API can enforce', async () => {
    const bid = await makeBid()
    renderTab(bid.id)
    await screen.findByText('Tender ID')
    expect(screen.getAllByTestId('protected-row').map((r) => r.textContent?.replace(/Freeze Value$/, ''))).toEqual([
      'Tender ID', 'Estimated Value', 'EMD / Tender Fee', 'Submission Deadline', 'Tender Link',
    ])
  })

  it('freezes a field and shows it frozen', async () => {
    const bid = await makeBid()
    renderTab(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Freeze Estimated Value' }))
    expect(await within(row('Estimated Value')).findByText('Frozen')).toBeInTheDocument()
    expect((await repository.listProtectedValues('bid', bid.id))[0]).toMatchObject({ fieldKey: 'valueAmount', frozen: true })
  })

  it('unfreezing requires a non-empty reason before the confirm button is enabled', async () => {
    const bid = await makeBid()
    await repository.freezeValue('bid', bid.id, 'submissionDeadline')
    renderTab(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Unfreeze Submission Deadline' }))
    const confirm = screen.getByRole('button', { name: /confirm unfreeze/i })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText(/reason/i), '   ')
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText(/reason/i), 'Client confirmed the extension')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(within(row('Submission Deadline')).queryByText('Frozen')).not.toBeInTheDocument())
    expect((await repository.listProtectedValues('bid', bid.id)).find((p) => p.fieldKey === 'submissionDeadline')!.frozen).toBe(false)
  })

  it('cancelling an unfreeze leaves the value frozen', async () => {
    const bid = await makeBid()
    await repository.freezeValue('bid', bid.id, 'tenderLink')
    renderTab(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Unfreeze Tender Link' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(within(row('Tender Link')).getByText('Frozen')).toBeInTheDocument()
  })
})

// Protection is switched off for now (PROTECTED_VALUES_ENFORCED = false):
// freeze records are still kept, but they never block an edit.
describe('protected values are not enforced by the local repository', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('a frozen field still accepts direct edits', async () => {
    const bid = await makeBid()
    await repository.freezeValue('bid', bid.id, 'tenderLink')
    await expect(repository.updateBid(bid.id, { tenderLink: 'http://x' })).resolves.toBeTruthy()
    await repository.freezeValue('bid', bid.id, 'valueAmount')
    await expect(repository.updateOpportunity(bid.opportunityId, { valueAmount: '9' })).resolves.toBeTruthy()
    const [deadline] = await repository.listBidMilestones(bid.id)
    await repository.freezeValue('bid', bid.id, 'submissionDeadline')
    await expect(repository.updateBidMilestone(deadline.id, { dueAt: '2099-05-01T00:00:00.000Z' })).resolves.toBeTruthy()
  })
})

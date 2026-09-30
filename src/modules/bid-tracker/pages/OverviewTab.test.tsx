import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import type { Bid } from '@/lib/types'
import { OverviewTab } from './OverviewTab'

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Tender', submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}

function renderTab(bid: Bid) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><OverviewTab bid={bid} milestones={[]} /></QueryClientProvider>)
}

describe('OverviewTab — Data Confidence', () => {
  beforeEach(async () => { await resetLocalData() })

  it('shows no Mark Verified button for a verified bid', async () => {
    const bid = await makeBid()
    renderTab(bid)
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark verified/i })).not.toBeInTheDocument()
  })

  it('disables Mark Verified, with a note, while a corrigendum is pending review', async () => {
    const bid = await makeBid()
    await repository.createBidCorrigendum({
      bidId: bid.id, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2099-02-01T00:00:00.000Z' }],
    })
    renderTab((await repository.getBid(bid.id))!)
    await waitFor(() => expect(screen.getByRole('button', { name: /mark verified/i })).toBeDisabled())
    expect(screen.getByText(/resolve the pending corrigendum/i)).toBeInTheDocument()
  })

  it('enables Mark Verified for a needs_review bid with nothing pending, and clears the flag on click', async () => {
    const bid = await makeBid()
    const corrigendum = await repository.createBidCorrigendum({
      bidId: bid.id, corrigendumNumber: 1,
      changes: [{ fieldKey: 'submissionDeadline', currentValue: '', proposedValue: '2099-02-01T00:00:00.000Z' }],
    })
    await repository.reviewCorrigendumChange({ changeId: corrigendum.changes[0].id, decision: 'rejected' })
    renderTab((await repository.getBid(bid.id))!)
    const button = await screen.findByRole('button', { name: /mark verified/i })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    await waitFor(async () => expect((await repository.getBid(bid.id))!.dataConfidence).toBe('verified'))
  })
})

describe('OverviewTab — Next Action', () => {
  beforeEach(async () => { await resetLocalData() })

  it('creates a Next Action for the bid, which then shows as open and clears the inputs', async () => {
    const bid = await makeBid()
    renderTab(bid)
    const add = screen.getByRole('button', { name: /add next action/i })
    expect(add).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText(/next action/i), 'Confirm EMD instrument')
    await userEvent.type(screen.getByLabelText(/due date/i), '2099-12-01')
    await userEvent.click(add)
    expect(await screen.findByText('Confirm EMD instrument')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/next action/i)).toHaveValue('')
    const stored = await repository.listFollowUps('bid', bid.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ note: 'Confirm EMD instrument', dueDate: '2099-12-01', status: 'open' })
  })

  it('marks an open Next Action done, removing it from the open list', async () => {
    const bid = await makeBid()
    await repository.createFollowUp({ entityType: 'bid', entityId: bid.id, dueDate: '2099-12-01', note: 'Confirm EMD instrument' })
    renderTab(bid)
    await screen.findByText('Confirm EMD instrument')
    await userEvent.click(screen.getByRole('button', { name: /mark done/i }))
    await waitFor(() => expect(screen.queryByText('Confirm EMD instrument')).not.toBeInTheDocument())
    expect((await repository.listFollowUps('bid', bid.id))[0].status).toBe('done')
  })

  it('deletes a Next Action', async () => {
    const bid = await makeBid()
    await repository.createFollowUp({ entityType: 'bid', entityId: bid.id, dueDate: '2099-12-01', note: 'Drop me' })
    renderTab(bid)
    await screen.findByText('Drop me')
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(screen.queryByText('Drop me')).not.toBeInTheDocument())
    expect(await repository.listFollowUps('bid', bid.id)).toHaveLength(0)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { MilestonesTab } from '../pages/MilestonesTab'
import { CorrigendumReviewDialog } from './CorrigendumReviewDialog'

async function makeBidWithCorrigendum() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', submissionDate: '2099-01-15' })
  const bid = await repository.createBid(opp.id)
  const cor = await repository.createBidCorrigendum({
    bidId: bid.id, corrigendumNumber: 2,
    changes: [
      { fieldKey: 'submissionDeadline', currentValue: '2099-01-15T00:00:00.000Z', proposedValue: '2099-02-01T00:00:00.000Z' },
      { fieldKey: 'tenderLink', currentValue: '', proposedValue: 'http://new-link' },
    ],
  })
  return { bid, opp, cor }
}
function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('CorrigendumReviewDialog', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('applies only the ticked changes and keeps the rest, through reviewCorrigendumChange', async () => {
    const { bid, opp, cor } = await makeBidWithCorrigendum()
    wrap(<CorrigendumReviewDialog bidId={bid.id} corrigendumId={cor.id} onClose={() => {}} />)
    expect(await screen.findByText('Review Corrigendum 2 Changes')).toBeInTheDocument()
    expect(screen.getByText('Submission Deadline')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('checkbox', { name: /accept change/i })[0]) // the deadline
    await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }))
    await waitFor(async () => {
      const [c] = await repository.listBidCorrigenda(bid.id)
      expect(c.status).toBe('reviewed')
      expect(c.changes.map((ch) => ch.decision)).toEqual(['accepted', 'rejected'])
    })
    expect((await repository.listBidMilestones(bid.id))[0].dueAt).toBe('2099-02-01T00:00:00.000Z')
    expect((await repository.getOpportunity(opp.id))!.submissionDate).toBe('2099-02-01')
    expect((await repository.getBid(bid.id))!.tenderLink).toBeNull() // rejected: existing value kept
  })

  it('never overrides a frozen field: the rejection is shown and nothing after it is applied', async () => {
    const { bid, cor } = await makeBidWithCorrigendum()
    await repository.freezeValue('bid', bid.id, 'submissionDeadline')
    wrap(<CorrigendumReviewDialog bidId={bid.id} corrigendumId={cor.id} onClose={() => {}} />)
    await userEvent.click((await screen.findAllByRole('checkbox', { name: /accept change/i }))[0])
    await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/frozen|protected/)
    expect((await repository.listBidMilestones(bid.id))[0].dueAt).toBe('2099-01-15T00:00:00.000Z')
    expect((await repository.listBidCorrigenda(bid.id))[0].changes.every((c) => c.decision === 'pending')).toBe(true)
  })
})

describe('Milestones tab corrigendum entry point', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('shows a review banner for a pending corrigendum and opens the dialog; none once reviewed', async () => {
    const { bid, cor } = await makeBidWithCorrigendum()
    wrap(<MilestonesTab bidId={bid.id} />)
    expect(await screen.findByText(/Corrigendum 2 has 2 change\(s\) awaiting review/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Review Corrigendum 2' }))
    expect(await screen.findByText('Review Corrigendum 2 Changes')).toBeInTheDocument()
    for (const ch of cor.changes) await repository.reviewCorrigendumChange({ changeId: ch.id, decision: 'rejected' })
  })

  it('has no banner when nothing is pending', async () => {
    const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'X' })
    const bid = await repository.createBid(opp.id)
    wrap(<MilestonesTab bidId={bid.id} />)
    await screen.findByText('Submission Deadline')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

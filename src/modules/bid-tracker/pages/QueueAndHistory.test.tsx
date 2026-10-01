import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { ActionQueuePage } from './ActionQueuePage'
import { ActivityHistoryPage } from './ActivityHistoryPage'

async function makeBid(name = 'AI Document Processing System') {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}
function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/x']}>
        <Routes>
          <Route path="/x" element={ui} />
          <Route path="/bid-tracker/bid/:bidId" element={<div>bid detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ActionQueuePage', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('lists each open follow-up with its bid, owner, due date and attention flag, and opens the bid', async () => {
    const bid = await makeBid()
    const person = await repository.createSalesPerson({ name: 'Asha Rao', officialEmail: 'asha@amnex.com', designation: 'RM', tierKey: 'rm' })
    await repository.createFollowUp({ entityType: 'bid', entityId: bid.id, dueDate: '2020-01-01', note: 'Verify Security Clearance Level 3', assigneeId: person.id })
    wrap(<ActionQueuePage />)
    const row = await screen.findByTestId('action-row')
    expect(within(row).getByText('AI Document Processing System')).toBeInTheDocument()
    expect(within(row).getByText(bid.bidCode)).toBeInTheDocument()
    expect(within(row).getByText('Solutioning')).toBeInTheDocument()
    expect(within(row).getByText(/Verify Security Clearance Level 3/)).toBeInTheDocument()
    expect(within(row).getByText('Asha Rao')).toBeInTheDocument()
    expect(within(row).getByText('Overdue')).toBeInTheDocument()
    await userEvent.click(row)
    expect(await screen.findByText('bid detail page')).toBeInTheDocument()
  })

  it('shows unassigned actions, skips archived bids, and has an empty state', async () => {
    wrap(<ActionQueuePage />)
    expect(await screen.findByTestId('action-queue-empty')).toBeInTheDocument()
  })

  it('leaves out actions of archived bids and ones already done', async () => {
    const live = await makeBid('Live'); const archived = await makeBid('Archived')
    await repository.createFollowUp({ entityType: 'bid', entityId: live.id, dueDate: '2099-03-01', note: 'Keep me' })
    const done = await repository.createFollowUp({ entityType: 'bid', entityId: live.id, dueDate: '2099-03-02', note: 'Finished' })
    await repository.setFollowUpStatus(done.id, 'done')
    await repository.createFollowUp({ entityType: 'bid', entityId: archived.id, dueDate: '2099-03-03', note: 'Hidden' })
    await repository.archiveBid(archived.id)
    wrap(<ActionQueuePage />)
    expect(await screen.findByText('Keep me')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.queryByText('Finished')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })
})

describe('ActivityHistoryPage', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('merges audit-log edits and ownership history into one feed, leaving out non-bid ownership', async () => {
    const bid = await makeBid()
    await repository.updateBid(bid.id, { stageKey: 'qualification' })
    const person = await repository.createSalesPerson({ name: 'Asha Rao', officialEmail: 'asha@amnex.com', designation: 'RM', tierKey: 'rm' })
    await repository.assignOwner({ entityType: 'bid', entityId: bid.id, salesPersonId: person.id, startDate: '2026-09-03' })
    // An opportunity-level assignment is not Bid Tracker history.
    await repository.assignOwner({ entityType: 'opportunity', entityId: bid.opportunityId, salesPersonId: person.id, startDate: '2026-09-01' })
    wrap(<ActivityHistoryPage />)
    await screen.findAllByTestId('activity-entry')
    const rows = screen.getAllByTestId('activity-entry')
    expect(rows).toHaveLength(2)
    const texts = rows.map((r) => r.textContent ?? '')
    expect(texts.some((t) => /owner assigned \(owner\): Asha Rao/i.test(t))).toBe(true)
    expect(texts.some((t) => t.includes('stageKey: solutioning → qualification'))).toBe(true)
    expect(screen.getAllByRole('link', { name: 'Open bid' }).length).toBeGreaterThan(0)
  })

  it('shows custom-column definition changes and value edits', async () => {
    const bid = await makeBid()
    const f = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    await repository.setBidCustomValue(bid.id, f.id, 7)
    wrap(<ActivityHistoryPage />)
    expect(await screen.findByText(/score: — → 7/)).toBeInTheDocument()
    expect(screen.getByText(/name: — → Score/)).toBeInTheDocument()
  })

  it('labels entries whose bid was hard-deleted, and has an empty state', async () => {
    const bid = await makeBid()
    await repository.updateBid(bid.id, { stageKey: 'qualification' })
    await repository.deleteBid(bid.id)
    wrap(<ActivityHistoryPage />)
    expect(await screen.findByText(/this bid was deleted/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open bid' })).not.toBeInTheDocument()
  })

  it('shows an empty state with no activity', async () => {
    wrap(<ActivityHistoryPage />)
    expect(await screen.findByTestId('history-empty')).toBeInTheDocument()
  })
})

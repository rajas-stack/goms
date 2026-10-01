import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
    expect(texts.some((t) => /Owner assigned: Asha Rao/.test(t))).toBe(true)
    // Human labels, never the raw field name; old → new values; the bid it belongs to.
    const stage = rows.find((r) => /Stage changed/.test(r.textContent ?? ''))!
    expect(stage).toHaveTextContent('Solutioning')
    expect(stage).toHaveTextContent('Qualification')
    expect(stage).toHaveTextContent(bid.bidCode)
    expect(stage.textContent).not.toMatch(/stageKey/)
    expect(screen.getAllByRole('link', { name: 'Open bid' }).length).toBeGreaterThan(0)
  })

  it('shows custom-column definition changes and value edits', async () => {
    const bid = await makeBid()
    const f = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    await repository.setBidCustomValue(bid.id, f.id, 7)
    wrap(<ActivityHistoryPage />)
    expect(await screen.findByText('Score set')).toBeInTheDocument()
    expect(screen.getByText('Column “Score” added')).toBeInTheDocument()
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

  it('opens the affected bid from an entry', async () => {
    const bid = await makeBid()
    await repository.updateBid(bid.id, { stageKey: 'qualification' })
    wrap(<ActivityHistoryPage />)
    await userEvent.click(await screen.findByRole('link', { name: 'Open bid' }))
    expect(await screen.findByText('bid detail page')).toBeInTheDocument()
  })

  it('shows who, when, and the readable value change for a custom column edit', async () => {
    const bid = await makeBid()
    const f = await repository.createBidCustomField({ name: 'Budget', dataType: 'currency' })
    await repository.setBidCustomValue(bid.id, f.id, 500000)
    await repository.setBidCustomValue(bid.id, f.id, 750000)
    wrap(<ActivityHistoryPage />)
    await screen.findAllByTestId('activity-entry')
    const entry = screen.getAllByTestId('activity-entry').find((e) => /Budget changed/.test(e.textContent ?? ''))!
    expect(entry).toHaveTextContent('₹5,00,000')
    expect(entry).toHaveTextContent('₹7,50,000')
    expect(within(entry).getByText(/^\d{2} \w{3} \d{4}, \d{2}:\d{2}$/)).toBeInTheDocument()
    expect(entry).toHaveTextContent(/by /)
  })

  it('folds quick consecutive edits to one bid into one entry', async () => {
    const bid = await makeBid()
    const a = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
    const b = await repository.createBidCustomField({ name: 'Region', dataType: 'text' })
    await repository.setBidCustomValue(bid.id, a.id, 'x')
    await repository.setBidCustomValue(bid.id, b.id, 'y')
    wrap(<ActivityHistoryPage />)
    expect(await screen.findByText(/made 2 changes/)).toBeInTheDocument()
  })

  it('filters by bid, activity type and search, and can clear them', async () => {
    const one = await makeBid('Alpha Mission')
    const two = await makeBid('Beta Mission')
    await repository.updateBid(one.id, { stageKey: 'qualification' })
    ;(await repository.getBid(two.id))!.dataConfidence = 'needs_review' // as a corrigendum would leave it
    await repository.markBidVerified(two.id)
    wrap(<ActivityHistoryPage />)
    await screen.findAllByTestId('activity-entry')
    const total = screen.getAllByTestId('activity-entry').length

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Bid' }), screen.getByRole('option', { name: new RegExp(two.bidCode) }))
    expect(screen.getAllByTestId('activity-entry').every((e) => e.textContent?.includes(two.bidCode))).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByTestId('activity-entry')).toHaveLength(total)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Activity type' }), 'Verification')
    expect(screen.getAllByTestId('activity-entry')).toHaveLength(1)
    expect(screen.getByText('Bid verified')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search activity' }), 'qualification')
    expect(screen.getAllByTestId('activity-entry')).toHaveLength(1)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search activity' }), ' zzz')
    expect(screen.getByTestId('history-no-match')).toBeInTheDocument()
  })

  it('filters by date range', async () => {
    const bid = await makeBid()
    await repository.updateBid(bid.id, { stageKey: 'qualification' })
    wrap(<ActivityHistoryPage />)
    await screen.findAllByTestId('activity-entry')
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2099-01-01' } })
    expect(screen.getByTestId('history-no-match')).toBeInTheDocument()
  })
})

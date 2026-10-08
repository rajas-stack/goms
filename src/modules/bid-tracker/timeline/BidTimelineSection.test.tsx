import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { BidDetailWorkspace } from '../BidDetailWorkspace'

function renderBid(bidId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/bid-tracker/bid/${bidId}`]}>
        <Routes><Route path="/bid-tracker/bid/:bidId" element={<BidDetailWorkspace />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Bid page lifecycle timeline', () => {
  beforeEach(async () => { await resetLocalData() })

  it('renders first in the Overview panel from the real bid, deadline and stage history', async () => {
    const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', city: 'Pune', submissionDate: '2099-01-15' })
    const bid = await repository.createBid(opp.id)
    await repository.updateBid(bid.id, { stageKey: 'qualification' })
    renderBid(bid.id)
    const section = await screen.findByRole('region', { name: 'Opportunity lifecycle timeline' })
    const panel = screen.getByRole('tabpanel')
    expect(panel.firstElementChild?.contains(section)).toBe(true)
    expect(within(section).getByText(/– 15 Jan 2099/)).toBeInTheDocument()
    expect(await within(section).findByRole('button', { name: /^Solutioning: Completed/ })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /^Qualification: In progress/ })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /^Submitted: Upcoming/ })).toBeInTheDocument()
  })

  it('says when the deadline is not set and the end is estimated', async () => {
    const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'No Deadline', city: 'Pune', submissionDate: '' })
    const bid = await repository.createBid(opp.id)
    renderBid(bid.id)
    const section = await screen.findByRole('region', { name: 'Opportunity lifecycle timeline' })
    expect(within(section).getByText(/Deadline not set/)).toBeInTheDocument()
  })
})

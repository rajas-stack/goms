import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { BidDetailWorkspace } from './BidDetailWorkspace'

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/bid-tracker/bid/:bidId" element={<BidDetailWorkspace />} />
          <Route path="/bid-tracker" element={<div>grid page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', city: 'Pune', submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}

describe('BidDetailWorkspace', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('renders the header, nine synopsis tabs and the Overview by default', async () => {
    const bid = await makeBid()
    renderAt(`/bid-tracker/bid/${bid.id}`)
    expect(await screen.findByRole('heading', { name: 'Smart Bus' })).toBeInTheDocument()
    expect(screen.getByText(bid.bidCode)).toBeInTheDocument()
    for (const tab of ['Overview', 'Scope of Work', 'PQ', 'TQ', 'Manpower', 'Milestone', 'Payment Terms', 'BoQ', 'Queries']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument()
    }
    expect(screen.queryByRole('tab', { name: 'Commercial & Files' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Protected Values' })).not.toBeInTheDocument()
    // Requirements are stage guidance, not a claim that evidence was submitted.
    expect(screen.getByText(/Finalize technical solution; Submit pre-bid queries/)).toBeInTheDocument()
    expect(screen.getByText(/completion or submission is not verified here/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Submission Deadline — 2099-01-15/)).toBeInTheDocument())
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('shows the resolved owner, marking an inherited one', async () => {
    const bid = await makeBid()
    const person = await repository.createSalesPerson({ name: 'Asha Rao', officialEmail: 'asha@amnex.com', designation: 'RM', tierKey: 'rm' })
    await repository.assignOwner({ entityType: 'opportunity', entityId: bid.opportunityId, salesPersonId: person.id, startDate: '2020-01-01' })
    renderAt(`/bid-tracker/bid/${bid.id}`)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('(inherited)')).toBeInTheDocument()
  })

  it('archives, restores and deletes the bid from its header, returning to the grid', async () => {
    const bid = await makeBid()
    renderAt(`/bid-tracker/bid/${bid.id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Archive/ }))
    expect(await screen.findByText('Archived')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Restore/ }))
    await waitFor(() => expect(screen.queryByText('Archived')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Delete bid/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('grid page')).toBeInTheDocument()
    expect(await repository.getBid(bid.id)).toBeFalsy()
  })

  it('links back to the Master Grid, and says so for a bid that no longer exists', async () => {
    renderAt('/bid-tracker/bid/nope')
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Back to the Master Grid' }))
    expect(await screen.findByText('grid page')).toBeInTheDocument()
  })
})

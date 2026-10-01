import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { MilestonesDatesPage } from './MilestonesDatesPage'

async function makeBid(name: string, submissionDate: string) {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate })
  return repository.createBid(opp.id)
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><MilestonesDatesPage /></MemoryRouter></QueryClientProvider>)
}

describe('MilestonesDatesPage', () => {
  beforeEach(async () => { await resetLocalData() })

  it('lists milestones across bids with the opportunity name, soonest first', async () => {
    await makeBid('Later Tender', '2099-12-01')
    await makeBid('Sooner Tender', '2099-10-05')
    renderPage()
    await screen.findByText('Sooner Tender')
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent('Sooner Tender')
    expect(rows[2]).toHaveTextContent('Later Tender')
    expect(within(rows[1]).getByText('Submission Deadline')).toBeInTheDocument()
  })

  it('omits milestones of an archived bid', async () => {
    const bid = await makeBid('Gone Tender', '2099-10-05')
    await repository.archiveBid(bid.id)
    renderPage()
    expect(await screen.findByText('No milestones yet.')).toBeInTheDocument()
  })
})

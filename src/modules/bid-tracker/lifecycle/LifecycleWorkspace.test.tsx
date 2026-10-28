import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { BidDetailWorkspace } from '../BidDetailWorkspace'

const show = (path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
  <MemoryRouter initialEntries={[path]}><Routes><Route path="/live-bids/bid/:bidId" element={<BidDetailWorkspace />} /></Routes></MemoryRouter>
</QueryClientProvider>)

describe('progressive opportunity workspace', () => {
  beforeEach(async () => { await resetLocalData() })

  it('saves Campaign, unlocks Funnel and retains its data after reversing', async () => {
    const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Regional transit discovery' })
    const bid = await repository.createBid(opportunity.id, undefined, 'campaign')
    let view = show(`/live-bids/bid/${bid.id}`)
    expect(await screen.findByRole('heading', { name: opportunity.opportunityName })).toBeVisible()
    expect(screen.queryByLabelText('Expected RFP date')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'PQ' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Client need'), 'Live fleet visibility')
    // Stage moves happen only from the Live Bids selection toolbar.
    expect(screen.queryByRole('button', { name: /Advance to|Move back to/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save stage details' }))
    await screen.findByText('Stage details saved.')
    await repository.updateBid(bid.id, { sheet: 'pipeline-funnel' })
    view.unmount(); view = show(`/live-bids/bid/${bid.id}`)
    expect(await screen.findByLabelText('Expected RFP date')).toBeVisible()
    expect(screen.getByLabelText('Client need')).toHaveValue('Live fleet visibility')
    expect(screen.queryByLabelText('Forecast close date')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Qualification evidence'), 'Client confirmed need')
    await userEvent.click(screen.getByRole('button', { name: 'Save stage details' }))
    await screen.findByText('Stage details saved.')
    await repository.updateBid(bid.id, { sheet: 'campaign' })
    view.unmount(); show(`/live-bids/bid/${bid.id}`)
    await screen.findByLabelText('Client need')
    expect(screen.queryByLabelText('Expected RFP date')).not.toBeInTheDocument()
    expect((await repository.getBid(bid.id))?.lifecycleData?.qualificationNotes).toBe('Client confirmed need')
  })

  it('limits an earlier-list link and a future-stage URL to the appropriate workspace', async () => {
    const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Early relationship' })
    const bid = await repository.createBid(opportunity.id, undefined, 'campaign')
    show(`/live-bids/bid/${bid.id}?stage=bidTracker&tab=pq`)
    await screen.findByLabelText('Client need')
    expect(screen.queryByRole('tab', { name: 'PQ' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Solution fit')).not.toBeInTheDocument()
  })
})

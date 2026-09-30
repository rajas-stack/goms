import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { CreateBidDialog } from './CreateBidDialog'

function renderDialog(onClose = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/bid-tracker']}>
        <Routes>
          <Route path="/bid-tracker" element={<CreateBidDialog open onClose={onClose} />} />
          <Route path="/bid-tracker/bid/:bidId" element={<div>Bid detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const opp = (name: string, extra: { gemTenderId?: string; city?: string } = {}) =>
  repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15', ...extra })

describe('CreateBidDialog', () => {
  beforeEach(async () => { await resetLocalData() })

  it('lists only opportunities that do not already have a bid', async () => {
    const withBid = await opp('Has a bid')
    await repository.createBid(withBid.id)
    await opp('Needs a bid')
    renderDialog()
    const list = await screen.findByTestId('bid-opportunity-list')
    await waitFor(() => expect(within(list).getByText('Needs a bid')).toBeInTheDocument())
    expect(within(list).queryByText('Has a bid')).not.toBeInTheDocument()
  })

  it('narrows the list by name, tender ID or city', async () => {
    await opp('Road Sensors', { gemTenderId: 'GEM/ROAD/1', city: 'Pune' })
    await opp('Water Meters', { gemTenderId: 'GEM/WATER/2', city: 'Surat' })
    renderDialog()
    await screen.findByText('Road Sensors')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search opportunities' }), 'surat')
    expect(screen.queryByText('Road Sensors')).not.toBeInTheDocument()
    expect(screen.getByText('Water Meters')).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search opportunities' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search opportunities' }), 'GEM/ROAD')
    expect(screen.getByText('Road Sensors')).toBeInTheDocument()
    expect(screen.queryByText('Water Meters')).not.toBeInTheDocument()
  })

  it('creates the bid through the shared create path and opens its detail page', async () => {
    const target = await opp('Smart Poles')
    renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: /Smart Poles/ }))
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    const created = await repository.getBidForOpportunity(target.id)
    expect(created).not.toBeNull()
    expect(created?.opportunityId).toBe(target.id)
  })

  it('has no way to create a bid without an opportunity, and says so when none are free', async () => {
    const only = await opp('Only one')
    await repository.createBid(only.id)
    renderDialog()
    expect(await screen.findByTestId('bid-opportunity-empty')).toHaveTextContent('Every opportunity already has a bid')
    expect(screen.queryByRole('button', { name: /Create bid/ })).not.toBeInTheDocument()
  })

  it('shows the server message and stays open when creation is rejected (e.g. a bid was created in another tab)', async () => {
    const raced = await opp('Raced')
    renderDialog()
    const button = await screen.findByRole('button', { name: /Raced/ })
    await repository.createBid(raced.id) // someone else got there first
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('already has a bid')
    expect(screen.queryByText('Bid detail page')).not.toBeInTheDocument()
  })
})

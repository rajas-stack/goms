import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { MasterGrid } from '../components/MasterGrid'
import { resolveColumns } from '../gridColumns'
import { GeneralTab } from './GeneralTab'

async function makeBid(name = 'Shared bid') {
  const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name })
  return repository.createBid(opportunity.id)
}

function renderBoth(bidId: string, visibleColumns?: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <MasterGrid visibleColumns={visibleColumns} /><GeneralTab bidId={bidId} />
  </MemoryRouter></QueryClientProvider>)
}

const grid = () => within(screen.getByTestId('bid-master-grid'))
const general = () => within(screen.getByTestId('bid-general-form'))

describe('General and grid share columns and values', () => {
  beforeEach(async () => {
    await resetLocalData()
    localStorage.clear()
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) })
  })

  it('lists the same available data columns, including General fields and custom fields', async () => {
    const bid = await makeBid()
    await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    renderBoth(bid.id)
    const form = await screen.findByTestId('bid-general-form')
    const fields = await repository.listBidCustomFields()
    expect([...form.querySelectorAll('[data-column-id]')].map(element => element.getAttribute('data-column-id')))
      .toEqual(resolveColumns(fields).filter(column => column.type !== null).map(column => column.id))
    await userEvent.click(grid().getByRole('button', { name: /^Manage columns/ }))
    expect(await screen.findByRole('button', { name: 'Show Contract Duration' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show Opportunity ID' })).not.toBeInTheDocument()
  })

  it('saves standard and custom edits in either view and immediately updates the other', async () => {
    const bid = await makeBid()
    await repository.updateOpportunity(bid.opportunityId, { stateCode: 27 }) // Maharashtra: City lists its districts
    await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    renderBoth(bid.id, ['opportunityName', 'city', 'custom:score'])
    await screen.findByTestId('bid-general-form')
    await userEvent.click(grid().getByRole('button', { name: /editing locked/ }))
    await userEvent.click(grid().getByRole('button', { name: 'Edit City' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search City' }), 'Pune{Enter}')
    await waitFor(() => expect(general().getByRole('button', { name: 'Edit City' })).toHaveTextContent('Pune'))
    await userEvent.click(general().getByRole('button', { name: 'Edit City' }))
    // Not one of Maharashtra's districts: picked as a typed city ("+ Add").
    await userEvent.type(screen.getByRole('textbox', { name: 'Search City' }), 'Navi Mumbai{Enter}')
    await waitFor(() => expect(grid().getByRole('button', { name: 'Edit City' })).toHaveTextContent('Navi Mumbai'))
    await userEvent.click(general().getByRole('button', { name: 'Edit Score' }))
    await userEvent.type(general().getByRole('spinbutton', { name: 'Score' }), '42{Enter}')
    await waitFor(() => expect(grid().getByRole('button', { name: 'Edit Score' })).toHaveTextContent('42'))
    expect((await repository.listBidCustomValues(bid.id)).score).toBe(42)
  })

  it('shares original General values and preserves date-time values when edited in the grid', async () => {
    const bid = await makeBid()
    renderBoth(bid.id, ['opportunityName', 'general:contractDuration', 'general:preBidMeeting'])
    await screen.findByTestId('bid-general-form')
    await userEvent.type(general().getByRole('textbox', { name: 'Contract Duration' }), 'Five years')
    await userEvent.tab()
    await waitFor(() => expect(grid().getByText('Five years')).toBeInTheDocument())
    await userEvent.click(grid().getByRole('button', { name: /editing locked/ }))
    await userEvent.click(grid().getByRole('button', { name: 'Edit Contract Duration' }))
    await userEvent.clear(grid().getByRole('textbox', { name: 'Contract Duration' }))
    await userEvent.type(grid().getByRole('textbox', { name: 'Contract Duration' }), 'Seven years{Enter}')
    await waitFor(() => expect(general().getByRole('textbox', { name: 'Contract Duration' })).toHaveValue('Seven years'))
    await userEvent.click(grid().getByRole('button', { name: 'Edit Pre-Bid Meeting Date & Time' }))
    await userEvent.type(grid().getByRole('textbox', { name: 'Pre-Bid Meeting Date & Time' }), '15 Oct 2026 11:00{Enter}')
    await waitFor(async () => expect((await repository.listBidsForGrid()).find(row => row.id === bid.id)?.generalValues?.preBidMeeting).toBe('2026-10-15T11:00'))
  })

  it('creates a field from General and exposes it as a grid column without reopening either view', async () => {
    const bid = await makeBid()
    renderBoth(bid.id)
    await screen.findByTestId('bid-general-form')
    await userEvent.click(general().getByRole('button', { name: 'Add field' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add column' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Column name/ }), 'Client reference')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add column' }))
    expect(await grid().findByRole('button', { name: 'Sort by Client reference' })).toBeInTheDocument()
    expect(await general().findByRole('button', { name: 'Edit Client reference' })).toBeInTheDocument()
  })
})

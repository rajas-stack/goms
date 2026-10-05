import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { OwnedSheet } from '@goms/domain'
import { repository, resetLocalData } from '@/data/repository'
import { DashboardPage } from './DashboardPage'

async function makeIn(name: string, sheet: OwnedSheet, vertical = '') {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  if (vertical) await repository.updateOpportunity(opp.id, { vertical })
  return repository.createBid(opp.id, undefined, sheet)
}

const Search = () => <div data-testid="search">{useLocation().search}</div>

function renderPage(path = '/bid-tracker/dashboard') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><Search /><DashboardPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}
const tile = (key: string) => screen.getByTestId(`tile-${key}`).textContent

describe('DashboardPage', () => {
  beforeEach(async () => { await resetLocalData() })

  it('counts live bids, pipeline and campaign rows from their sheets', async () => {
    await makeIn('Live one', 'bidTracker', 'GIS')
    const closed = await makeIn('Closed one', 'bidTracker', 'GIS')
    await repository.updateBid(closed.id, { decision: 'no_go' })
    const archived = await makeIn('Archived one', 'bidTracker', 'GIS')
    await repository.archiveBid(archived.id)
    await makeIn('Funnel one', 'pipeline-funnel', 'Traffic')
    await makeIn('Funnel two', 'pipeline-funnel', 'GIS')
    await makeIn('Commit one', 'pipeline-commits', 'Traffic')
    await makeIn('Camp one', 'campaign')

    renderPage()
    expect(await screen.findByTestId('tile-live')).toHaveTextContent('1')
    expect(tile('pipeline')).toBe('3')
    expect(tile('campaign')).toBe('1')
    expect(screen.getByText('Funnel 2 · Backup 0 · Commits 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Live bids: 1. Open Bid Tracker' })).toHaveAttribute('href', '/bid-tracker')
    expect(screen.getByRole('link', { name: 'Pipeline: 3. Open Pipeline' })).toHaveAttribute('href', '/bid-tracker/pipeline/funnel')
    expect(screen.getByRole('link', { name: 'Campaign: 1. Open Campaign' })).toHaveAttribute('href', '/bid-tracker/campaign')

    // The by-vertical breakdown has an accessible table with exact counts.
    const table = screen.getByRole('table', { name: 'Counts by vertical' })
    const gis = within(table).getByRole('rowheader', { name: 'GIS' }).closest('tr')!
    expect(within(gis).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '1', '0'])
    expect(within(table).getByRole('rowheader', { name: 'Unassigned' })).toBeInTheDocument()
  })

  it('the vertical filter narrows the counts and is kept in the URL', async () => {
    await makeIn('Live one', 'bidTracker', 'GIS')
    await makeIn('Funnel one', 'pipeline-funnel', 'Traffic')
    await makeIn('Camp one', 'campaign', 'Traffic')
    renderPage()
    expect(await screen.findByTestId('tile-live')).toHaveTextContent('1')
    const select = screen.getByRole('combobox', { name: 'Vertical' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toContain('Transit (Mobility)')
    await userEvent.selectOptions(select, 'Traffic')
    expect(screen.getByTestId('search')).toHaveTextContent('?vertical=Traffic')
    expect(tile('live')).toBe('0')
    expect(tile('pipeline')).toBe('1')
    expect(tile('campaign')).toBe('1')

    await userEvent.selectOptions(select, 'Cloud')
    expect(screen.getByTestId('dashboard-empty')).toHaveTextContent('Nothing in Cloud')
    await userEvent.click(screen.getByRole('button', { name: 'Show all verticals' }))
    expect(tile('live')).toBe('1')
    expect(screen.getByTestId('search')).toHaveTextContent(/^$/)
  })

  it('reads the vertical from the URL and shows an empty state with nothing at all', async () => {
    renderPage('/bid-tracker/dashboard?vertical=GIS')
    expect(await screen.findByTestId('dashboard-empty')).toHaveTextContent('Nothing in GIS')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { OpportunityWorkspace } from './OpportunityWorkspace'
import type { OwnedSheet } from './sheets'

function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}),
  })
}
const Where = () => <div data-testid="where">{useLocation().pathname}</div>

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/live-bids" element={<OpportunityWorkspace tab="bid-tracker" />} />
          <Route path="/live-bids/pipeline" element={<OpportunityWorkspace tab="pipeline" />} />
          <Route path="/live-bids/pipeline/:tab" element={<OpportunityWorkspace tab="pipeline" />} />
          <Route path="/live-bids/campaign" element={<OpportunityWorkspace tab="campaign" />} />
          <Route path="/live-bids/master" element={<OpportunityWorkspace tab="master" />} />
          <Route path="/live-bids/dashboard" element={<OpportunityWorkspace tab="dashboard" />} />
          <Route path="/live-bids/:section" element={<OpportunityWorkspace tab="bid-tracker" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function makeBid(name: string, sheet?: OwnedSheet) {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  return repository.createBid(opp.id, undefined, sheet)
}
const SHEET_AT: Record<string, OwnedSheet> = {
  '/live-bids/pipeline/funnel': 'pipeline-funnel', '/live-bids/pipeline/backup': 'pipeline-backup',
  '/live-bids/pipeline/commits': 'pipeline-commits', '/live-bids/campaign': 'campaign', '/live-bids/master': 'campaign',
}
const nav = () => within(screen.getByRole('navigation', { name: 'Opportunity sheets' }))
const where = () => screen.getByTestId('where').textContent
const pill = (name: string) => within(screen.getByTestId('saved-view-tabs')).getByRole('button', { name: new RegExp(`^${name}`) })

describe('Opportunity workspace', () => {
  beforeEach(async () => {
    stubLayout()
    await resetLocalData()
  })

  it('offers Live Bids, Pipeline, Campaign, Master and Dashboard, with Live Bids keeping its own sections', async () => {
    await makeBid('Alpha')
    renderAt('/live-bids')
    expect(nav().getAllByRole('link').map((l) => l.textContent)).toEqual(['Campaign', 'Pipeline', 'Live Bids', 'Master', 'Dashboard'])
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    for (const section of ['Master Grid', 'Milestones & Dates', 'Action Queue', 'Activity History']) {
      expect(screen.getByRole('button', { name: section })).toBeInTheDocument()
    }
  })

  it('Pipeline opens on Funnel and has Funnel / Backup / Commits sub-tabs', async () => {
    await makeBid('Alpha', 'pipeline-funnel')
    renderAt('/live-bids/pipeline')
    await waitFor(() => expect(where()).toBe('/live-bids/pipeline/funnel'))
    for (const label of ['Funnel', 'Backup', 'Commits']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Backup' }))
    await waitFor(() => expect(where()).toBe('/live-bids/pipeline/backup'))
    await userEvent.click(screen.getByRole('button', { name: 'Commits' }))
    await waitFor(() => expect(where()).toBe('/live-bids/pipeline/commits'))
  })

  it('moves between the top tabs', async () => {
    await makeBid('Alpha')
    renderAt('/live-bids')
    await userEvent.click(nav().getByRole('link', { name: 'Campaign' }))
    await waitFor(() => expect(where()).toBe('/live-bids/campaign'))
    await userEvent.click(nav().getByRole('link', { name: 'Master' }))
    await waitFor(() => expect(where()).toBe('/live-bids/master'))
    await userEvent.click(nav().getByRole('link', { name: 'Pipeline' }))
    await waitFor(() => expect(where()).toBe('/live-bids/pipeline/funnel'))
    await userEvent.click(nav().getByRole('link', { name: 'Dashboard' }))
    await waitFor(() => expect(where()).toBe('/live-bids/dashboard'))
    expect(await screen.findByRole('heading', { name: 'Opportunity dashboard' })).toBeInTheDocument()
  })

  it.each([['/live-bids/pipeline/funnel'], ['/live-bids/pipeline/backup'], ['/live-bids/pipeline/commits'], ['/live-bids/campaign'], ['/live-bids/master']])(
    '%s is the same Excel-style grid over its own rows, with lock, freeze, filters and Manage columns',
    async (path) => {
      await makeBid('Alpha', SHEET_AT[path])
      await makeBid('Beta', SHEET_AT[path])
      await makeBid('Elsewhere', path === '/live-bids/master' ? 'bidTracker' : undefined)
      renderAt(path)
      await screen.findByText('Alpha')
      expect(screen.getByText('Beta')).toBeInTheDocument()
      // Advanced opportunities remain in every earlier-stage list and in Master.
      expect(screen.getByText('Elsewhere')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Master grid editing locked/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Filters/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Manage columns/ })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Manage columns/ }))
      expect(await screen.findByRole('button', { name: /Add column/ })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Manage columns/ }))
      await userEvent.click(screen.getByRole('button', { name: 'City column menu' }))
      expect(screen.getByRole('menuitem', { name: 'Freeze column' })).toBeEnabled()
    },
  )

  it('each sheet has its own saved views; system views are on every sheet', async () => {
    await makeBid('Alpha', 'pipeline-funnel')
    await repository.createBidSavedView({ name: 'Funnel only', scope: 'global', sheet: 'pipeline-funnel' })
    await repository.createBidSavedView({ name: 'Campaign only', scope: 'global', sheet: 'campaign' })
    await repository.createBidSavedView({ name: 'Old tracker view', scope: 'global' }) // no sheet = Live Bids
    const first = renderAt('/live-bids/pipeline/funnel')
    await screen.findByText('Alpha')
    expect(await screen.findByRole('button', { name: /^Funnel only/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Campaign only/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Old tracker view/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All Opportunities' })).toBeInTheDocument()
    first.unmount()
    renderAt('/live-bids/campaign')
    expect(await screen.findByRole('button', { name: /^Campaign only/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Funnel only/ })).not.toBeInTheDocument()
  })

  it('a view created on a sheet belongs to that sheet', async () => {
    await makeBid('Alpha')
    renderAt('/live-bids/master')
    await screen.findByText('Alpha')
    await userEvent.click(screen.getByRole('button', { name: /Create Saved View/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /View Name/ }), 'Master view')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create View' }))
    await waitFor(async () => expect((await repository.listBidSavedViews()).find((v) => v.name === 'Master view')?.sheet).toBe('master'))
    expect(await screen.findByRole('button', { name: /^Master view/ })).toBeInTheDocument()
    expect(pill('Master view')).toHaveAttribute('aria-pressed', 'true')
  })

  it('frozen columns are remembered per sheet', async () => {
    await makeBid('Alpha', 'campaign')
    localStorage.clear()
    const first = renderAt('/live-bids/campaign')
    await screen.findByText('Alpha')
    await userEvent.click(screen.getByRole('button', { name: 'City column menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Freeze column' }))
    expect(JSON.parse(localStorage.getItem('goms:bidGrid:frozenColumns:campaign')!)).toEqual(['city'])
    expect(localStorage.getItem('goms:bidGrid:frozenColumns')).toBeNull()
    first.unmount()
    renderAt('/live-bids/master')
    await screen.findByText('Alpha')
    expect(screen.queryByTitle('Frozen column')).not.toBeInTheDocument()
  })
})

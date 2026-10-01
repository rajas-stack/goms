import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { OpportunityWorkspace } from './OpportunityWorkspace'

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
          <Route path="/bid-tracker" element={<OpportunityWorkspace tab="bid-tracker" />} />
          <Route path="/bid-tracker/pipeline" element={<OpportunityWorkspace tab="pipeline" />} />
          <Route path="/bid-tracker/pipeline/:tab" element={<OpportunityWorkspace tab="pipeline" />} />
          <Route path="/bid-tracker/campaign" element={<OpportunityWorkspace tab="campaign" />} />
          <Route path="/bid-tracker/master" element={<OpportunityWorkspace tab="master" />} />
          <Route path="/bid-tracker/:section" element={<OpportunityWorkspace tab="bid-tracker" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function makeBid(name: string) {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}
const nav = () => within(screen.getByRole('navigation', { name: 'Opportunity sheets' }))
const where = () => screen.getByTestId('where').textContent
const pill = (name: string) => within(screen.getByTestId('saved-view-tabs')).getByRole('button', { name: new RegExp(`^${name}`) })

describe('Opportunity workspace', () => {
  beforeEach(async () => {
    stubLayout()
    await resetLocalData()
  })

  it('offers Bid Tracker, Pipeline, Campaign and Master, with Bid Tracker keeping its own sections', async () => {
    await makeBid('Alpha')
    renderAt('/bid-tracker')
    for (const label of ['Bid Tracker', 'Pipeline', 'Campaign', 'Master']) {
      expect(nav().getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    for (const section of ['Master Grid', 'Milestones & Dates', 'Action Queue', 'Activity History']) {
      expect(screen.getByRole('button', { name: section })).toBeInTheDocument()
    }
  })

  it('Pipeline opens on Funnel and has Funnel / Backup / Commits sub-tabs', async () => {
    await makeBid('Alpha')
    renderAt('/bid-tracker/pipeline')
    await waitFor(() => expect(where()).toBe('/bid-tracker/pipeline/funnel'))
    for (const label of ['Funnel', 'Backup', 'Commits']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Backup' }))
    await waitFor(() => expect(where()).toBe('/bid-tracker/pipeline/backup'))
    await userEvent.click(screen.getByRole('button', { name: 'Commits' }))
    await waitFor(() => expect(where()).toBe('/bid-tracker/pipeline/commits'))
  })

  it('moves between the top tabs', async () => {
    await makeBid('Alpha')
    renderAt('/bid-tracker')
    await userEvent.click(nav().getByRole('link', { name: 'Campaign' }))
    await waitFor(() => expect(where()).toBe('/bid-tracker/campaign'))
    await userEvent.click(nav().getByRole('link', { name: 'Master' }))
    await waitFor(() => expect(where()).toBe('/bid-tracker/master'))
    await userEvent.click(nav().getByRole('link', { name: 'Pipeline' }))
    await waitFor(() => expect(where()).toBe('/bid-tracker/pipeline/funnel'))
  })

  it.each([['/bid-tracker/pipeline/funnel'], ['/bid-tracker/pipeline/backup'], ['/bid-tracker/pipeline/commits'], ['/bid-tracker/campaign'], ['/bid-tracker/master']])(
    '%s is the same Excel-style grid over the same bids, with lock, freeze, filters and Manage columns',
    async (path) => {
      await makeBid('Alpha')
      await makeBid('Beta')
      renderAt(path)
      await screen.findByText('Alpha')
      expect(screen.getByText('Beta')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Master grid editing locked/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Filters/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Manage columns/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Add column/ })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Tender ID column menu' }))
      expect(screen.getByRole('menuitem', { name: 'Freeze column' })).toBeEnabled()
    },
  )

  it('each sheet has its own saved views; system views are on every sheet', async () => {
    await makeBid('Alpha')
    await repository.createBidSavedView({ name: 'Funnel only', scope: 'global', sheet: 'pipeline-funnel' })
    await repository.createBidSavedView({ name: 'Campaign only', scope: 'global', sheet: 'campaign' })
    await repository.createBidSavedView({ name: 'Old tracker view', scope: 'global' }) // no sheet = Bid Tracker
    const first = renderAt('/bid-tracker/pipeline/funnel')
    await screen.findByText('Alpha')
    expect(await screen.findByRole('button', { name: /^Funnel only/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Campaign only/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Old tracker view/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All Bids' })).toBeInTheDocument()
    first.unmount()
    renderAt('/bid-tracker/campaign')
    expect(await screen.findByRole('button', { name: /^Campaign only/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Funnel only/ })).not.toBeInTheDocument()
  })

  it('a view created on a sheet belongs to that sheet', async () => {
    await makeBid('Alpha')
    renderAt('/bid-tracker/master')
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
    await makeBid('Alpha')
    localStorage.clear()
    const first = renderAt('/bid-tracker/campaign')
    await screen.findByText('Alpha')
    await userEvent.click(screen.getByRole('button', { name: 'City column menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Freeze column' }))
    expect(JSON.parse(localStorage.getItem('goms:bidGrid:frozenColumns:campaign')!)).toEqual(['city'])
    expect(localStorage.getItem('goms:bidGrid:frozenColumns')).toBeNull()
    first.unmount()
    renderAt('/bid-tracker/master')
    await screen.findByText('Alpha')
    expect(screen.queryByTitle('Frozen column')).not.toBeInTheDocument()
  })
})

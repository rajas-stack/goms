import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { PermissionsProvider } from '@/lib/permissions'
import { NodeAccessProvider } from '@/lib/rbacTree/access'
import type { RbacMyAccess } from '@goms/domain'
import { MasterGrid } from './MasterGrid'

const Location = () => { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }
function mount(options: { readOnly?: boolean; access?: RbacMyAccess; columns?: string[] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>
    <PermissionsProvider access={options.readOnly
      ? { mode: 'enforce', email: 'reader@example.com', roles: ['legal'], facts: { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } } }
      : { mode: 'off', email: null, roles: [], facts: null }}>
      <NodeAccessProvider access={options.access ?? { configured: false, allowed: {} }}>
        <MemoryRouter initialEntries={['/live-bids']}><Location /><MasterGrid visibleColumns={options.columns ?? ['opportunityName', 'legalPersonId', 'bidCode']} /></MemoryRouter>
      </NodeAccessProvider>
    </PermissionsProvider>
  </QueryClientProvider>)
}
async function seed() {
  const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Menu test', submissionDate: '2099-01-15' })
  return repository.createBid(opportunity.id)
}
async function openMenu(id: string, column = 'opportunityName') {
  await screen.findByRole('button', { name: 'Menu test' })
  fireEvent.contextMenu(document.querySelector(`[data-cell="${id}:${column}"]`)!)
  return screen.findByRole('menu')
}

describe('Live Bids context actions', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) })
    await resetLocalData()
  })

  it.each([
    ['Open bid synopsis', 'general'], ['View RFP timeline', 'rfpTimeline'], ['Open communications', 'communication'],
  ])('%s opens its real bid section', async (label, tab) => {
    const bid = await seed(); mount()
    await userEvent.click(within(await openMenu(bid.id)).getByRole('menuitem', { name: label }))
    expect(screen.getByTestId('location')).toHaveTextContent(`/live-bids/bid/${bid.id}?tab=${tab}`)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows the actual stage and only its adjacent moves after reversal', async () => {
    const bid = await seed()
    await repository.updateBid(bid.id, { sheet: 'pipeline-commits' })
    mount()
    const menu = await openMenu(bid.id)
    expect(menu).toHaveTextContent('Current stage: Commit')
    expect(within(menu).getByRole('menuitem', { name: 'Move back to Backup' })).toBeEnabled()
    expect(within(menu).queryByRole('menuitem', { name: 'Open bid synopsis' })).not.toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Advance to Live Bid' }))
    await waitFor(async () => expect((await repository.getBid(bid.id))?.sheet).toBe('bidTracker'))
  })

  it('unlocks, opens the selected editor and saves its new value', async () => {
    const bid = await seed(); mount()
    await userEvent.click(within(await openMenu(bid.id)).getByRole('menuitem', { name: 'Edit cell (unlocks editing)' }))
    const input = await screen.findByRole('textbox', { name: 'Opportunity / Mission' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Revised opportunity{Enter}')
    await waitFor(async () => expect((await repository.listBidsForGrid()).find(row => row.id === bid.id)?.opportunityName).toBe('Revised opportunity'))
  })

  it('omits copy/filter for an empty cell and edit for a read-only column', async () => {
    const bid = await seed(); mount()
    const blank = await openMenu(bid.id, 'legalPersonId')
    expect(within(blank).queryByRole('menuitem', { name: 'Copy value' })).not.toBeInTheDocument()
    expect(within(blank).queryByRole('menuitem', { name: /^Filter:/ })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    const readOnly = await openMenu(bid.id, 'bidCode')
    expect(within(readOnly).queryByRole('menuitem', { name: /Edit cell/ })).not.toBeInTheDocument()
  })

  it('copies a link and reports clipboard failures', async () => {
    const bid = await seed()
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Clipboard blocked'))
    Object.assign(navigator, { clipboard: { writeText } }); mount()
    await userEvent.click(within(await openMenu(bid.id)).getByRole('menuitem', { name: 'Copy bid link' }))
    expect(writeText).toHaveBeenCalledWith(new URL(`/live-bids/bid/${bid.id}`, window.location.href).href)
    await userEvent.click(within(await openMenu(bid.id)).getByRole('menuitem', { name: 'Copy value' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard blocked')
  })

  it('hides mutations the role cannot perform but keeps personal favourites', async () => {
    const bid = await seed(); mount({ readOnly: true })
    const menu = await openMenu(bid.id)
    for (const name of [/Edit cell/, /Move back/, /Advance to/, /^Archive$/, /Delete bid/]) {
      expect(within(menu).queryByRole('menuitem', { name })).not.toBeInTheDocument()
    }
    expect(within(menu).getByRole('menuitem', { name: 'Add to favourites' })).toBeEnabled()
  })

  it('checks the destination permission before offering a move and hides restricted shortcuts', async () => {
    const bid = await seed()
    mount({ access: { configured: true, allowed: { opportunity: 63, 'opportunity.pipeline.commits': 1, 'opportunity.bid.communication': 0 } } })
    const menu = await openMenu(bid.id)
    expect(within(menu).queryByRole('menuitem', { name: 'Move back to Commit' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open communications' })).not.toBeInTheDocument()
  })

  it('reports an archive failure, and archived rows offer restore without stage moves', async () => {
    const bid = await seed()
    vi.spyOn(repository, 'archiveBid').mockRejectedValueOnce(new Error('Archive failed'))
    const view = mount()
    await userEvent.click(within(await openMenu(bid.id)).getByRole('menuitem', { name: 'Archive' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Archive failed')
    expect((await repository.getBid(bid.id))?.status).toBe('active')
    view.unmount()
    await repository.archiveBid(bid.id)
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /^Archived/ }))
    const menu = await openMenu(bid.id)
    expect(menu).toHaveTextContent('Archived')
    expect(within(menu).queryByRole('menuitem', { name: /Move back|Advance to|Edit cell/ })).not.toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Unarchive' }))
    await waitFor(async () => expect((await repository.getBid(bid.id))?.status).toBe('active'))
  })

  it('opens Change data type from a custom header and filters multiple selections correctly', async () => {
    const bid = await seed()
    const field = await repository.createBidCustomField({ name: 'Category', dataType: 'multiselect', options: ['One', 'Two'] })
    await repository.setBidCustomValue(bid.id, field.id, '["One","Two"]')
    mount({ columns: ['opportunityName', `custom:${field.key}`] })
    const cellMenu = await openMenu(bid.id, `custom:${field.key}`)
    expect(within(cellMenu).getByRole('menuitem', { name: 'Change data type…' })).toBeEnabled()
    await userEvent.click(within(cellMenu).getByRole('menuitem', { name: 'Filter: Category matches these values' }))
    expect(screen.getByTestId('bid-row')).toHaveTextContent('Menu test')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Sort by Category' }).closest('th')!)
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Change data type…' }))
    expect(await screen.findByRole('dialog', { name: 'Change data type' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New data type' }), 'date')
    await userEvent.click(screen.getByRole('button', { name: 'Change type and reset values' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByTestId('active-filters')).not.toBeInTheDocument())
    expect((await repository.listBidCustomValues(bid.id)).category).toBeUndefined()
    expect(screen.getByTestId('bid-row')).toHaveTextContent('Menu test')
  })

  it('refreshes the reset action after a previously empty column receives its first value', async () => {
    const bid = await seed()
    const field = await repository.createBidCustomField({ name: 'Estimate', dataType: 'number' })
    mount({ columns: ['opportunityName', `custom:${field.key}`] })
    await userEvent.click(within(await openMenu(bid.id, `custom:${field.key}`)).getByRole('menuitem', { name: /^Edit cell/ }))
    const input = await screen.findByRole('spinbutton', { name: 'Estimate' })
    await userEvent.type(input, '550{Enter}')
    await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).estimate).toBe(550))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Sort by Estimate' }).closest('th')!)
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Change data type…' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New data type' }), 'date')
    expect(screen.getByRole('button', { name: 'Change type and reset values' })).toBeEnabled()
  })

  it('distinguishes user inputs from generated fields and saves a timed submission deadline through its milestone', async () => {
    const bid = await seed()
    mount({ columns: ['opportunityName', 'bidCode', 'submissionDate', 'updatedAt'] })
    await screen.findByRole('button', { name: 'Menu test' })
    expect(document.querySelector(`[data-cell="${bid.id}:bidCode"]`)).toHaveAttribute('data-origin', 'system')
    expect(document.querySelector(`[data-cell="${bid.id}:submissionDate"]`)).toHaveAttribute('data-origin', 'human')
    expect(document.querySelector(`[data-cell="${bid.id}:updatedAt"]`)).toHaveAttribute('title', expect.stringContaining('System-generated'))
    await userEvent.click(within(await openMenu(bid.id, 'submissionDate')).getByRole('menuitem', { name: /^Edit cell/ }))
    const input = await screen.findByRole('textbox', { name: 'Submission Deadline' })
    await userEvent.clear(input)
    await userEvent.type(input, '28 Oct 2026 15:45{Enter}')
    await waitFor(async () => expect((await repository.listBidMilestones(bid.id)).find(item => item.key === 'submissionDeadline')?.dueAt).toBe(new Date(2026, 9, 28, 15, 45).toISOString()))
    expect((await repository.listBidsForGrid()).find(item => item.id === bid.id)?.submissionDate).toBe(new Date(2026, 9, 28, 15, 45).toISOString())
  })
})

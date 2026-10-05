import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { GridSheet } from './GridSheet'
import type { SheetId } from './sheets'

function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}),
  })
}
const Where = () => <div data-testid="where">{useLocation().pathname}</div>
function renderSheet(sheet: SheetId) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/sheet']}>
        <Where />
        <Routes>
          <Route path="/sheet" element={<GridSheet sheet={sheet} />} />
          <Route path="/bid-tracker/bid/:id" element={<div>details page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
async function makeBid(name: string) {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}
const leafHeaders = () => Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent?.replace('Frozen', ''))
const unlock = async () => userEvent.click(await screen.findByRole('button', { name: /editing locked/ }))

describe('Master aggregates every sheet\'s columns', () => {
  beforeEach(async () => {
    stubLayout()
    localStorage.clear()
    await resetLocalData()
  })

  async function seed() {
    const a = await makeBid('Alpha'); const b = await makeBid('Beta')
    const c1 = await repository.createBidCustomField({ name: 'Contact 1', dataType: 'text', sheet: 'bidTracker' })
    const c4 = await repository.createBidCustomField({ name: 'Contact 4', dataType: 'text', sheet: 'pipeline' })
    const c7 = await repository.createBidCustomField({ name: 'Contact 7', dataType: 'text', sheet: 'campaign' })
    await repository.setBidCustomValue(a.id, c1.id, 'one')
    await repository.setBidCustomValue(a.id, c4.id, 'four')
    await repository.setBidCustomValue(b.id, c7.id, 'seven')
    return { a, b, c1, c4, c7 }
  }

  it('each sheet shows only its own custom columns', async () => {
    await seed()
    const first = renderSheet('bidTracker')
    await screen.findByText('Alpha')
    expect(leafHeaders()).toContain('Contact 1')
    expect(leafHeaders()).not.toContain('Contact 4')
    expect(leafHeaders()).not.toContain('Contact 7')
    first.unmount()
    // Alpha / Beta live in Bid Tracker, so these sheets have no rows: wait for the columns instead.
    const second = renderSheet('pipeline-backup')
    await waitFor(() => expect(leafHeaders()).toContain('Contact 4'))
    expect(leafHeaders()).not.toContain('Contact 1')
    second.unmount()
    renderSheet('campaign')
    await waitFor(() => expect(leafHeaders()).toContain('Contact 7'))
    expect(leafHeaders()).not.toContain('Contact 4')
  })

  it('Master has every column of every sheet; a bid with no value there is blank', async () => {
    await seed()
    renderSheet('master')
    await screen.findByText('Alpha')
    for (const h of ['Contact 1', 'Contact 4', 'Contact 7']) expect(leafHeaders()).toContain(h)
    const rows = screen.getAllByTestId('bid-row')
    const alpha = rows.find((r) => within(r).queryByText('Alpha'))!
    const beta = rows.find((r) => within(r).queryByText('Beta'))!
    expect(within(alpha).getByText('one')).toBeInTheDocument()
    expect(within(alpha).getByText('four')).toBeInTheDocument()
    expect(within(alpha).queryByText('seven')).not.toBeInTheDocument() // Alpha has no Contact 7: blank
    expect(within(beta).getByText('seven')).toBeInTheDocument()
    expect(within(beta).queryByText('one')).not.toBeInTheDocument()
  })

  it('a column added on any sheet appears in Master automatically', async () => {
    await seed()
    renderSheet('master')
    await screen.findByText('Alpha')
    expect(leafHeaders()).not.toContain('Contact 9')
    await repository.createBidCustomField({ name: 'Contact 9', dataType: 'text', sheet: 'campaign' })
    const qc = new QueryClient()
    void qc
    // A fresh mount (what navigating to Master does) lists it with no setup.
    renderSheet('master')
    await waitFor(() => expect(leafHeaders()).toContain('Contact 9'))
  })

  it('the sheet switcher narrows Master to one sheet, or back to all', async () => {
    await seed()
    renderSheet('master')
    await screen.findByText('Alpha')
    const switcher = screen.getByRole('combobox', { name: 'Sheet' })
    expect(within(switcher).getAllByRole('option').map((o) => o.textContent)).toEqual(['All sheets', 'Bid Tracker', 'Pipeline', 'Campaign'])
    await userEvent.selectOptions(switcher, 'Bid Tracker')
    expect(leafHeaders()).toContain('Contact 1')
    expect(leafHeaders()).not.toContain('Contact 4')
    expect(leafHeaders()).not.toContain('Contact 7')
    await userEvent.selectOptions(switcher, 'Pipeline')
    expect(leafHeaders()).toContain('Contact 4')
    expect(leafHeaders()).not.toContain('Contact 1')
    await userEvent.selectOptions(switcher, 'All sheets')
    for (const h of ['Contact 1', 'Contact 4', 'Contact 7']) expect(leafHeaders()).toContain(h)
  })

  it('only Master has the switcher; a column added through Master belongs to the sheet in view', async () => {
    await seed()
    const first = renderSheet('campaign')
    await screen.findByTestId('bid-master-grid')
    expect(screen.queryByRole('combobox', { name: 'Sheet' })).not.toBeInTheDocument()
    first.unmount()
    renderSheet('master')
    await screen.findByText('Alpha')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sheet' }), 'Campaign')
    await userEvent.click(screen.getByRole('button', { name: /Add column/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Column name/ }), 'Camp Note')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add column' }))
    await waitFor(async () => expect((await repository.listBidCustomFields()).find((f) => f.name === 'Camp Note')?.sheet).toBe('campaign'))
  })

  it('Manage columns on a sheet lists only that sheet\'s custom columns', async () => {
    await seed()
    renderSheet('pipeline-funnel')
    await waitFor(() => expect(leafHeaders()).toContain('Contact 4'))
    await userEvent.click(screen.getByRole('button', { name: /^Manage columns/ }))
    const rows = await screen.findAllByTestId('custom-column-row')
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Contact 4')])
  })
})

describe('Manage cell, archive button, right-click menus, drag to reorder', () => {
  beforeEach(async () => {
    stubLayout()
    localStorage.clear()
    await resetLocalData()
  })

  it('the Manage cell has favourite, archive and delete buttons', async () => {
    const bid = await makeBid('Alpha')
    renderSheet('bidTracker')
    await screen.findByText('Alpha')
    const row = screen.getByTestId('bid-row')
    expect(within(row).getByRole('button', { name: 'Archive' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete bid' })).toBeInTheDocument()
    const fav = within(row).getByRole('button', { name: 'Add to favourites' })
    expect(fav).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(fav)
    expect(within(row).getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(localStorage.getItem('goms:bidGrid:favourites')!)).toEqual([bid.id])
    await userEvent.click(within(row).getByRole('button', { name: 'Remove from favourites' }))
    expect(JSON.parse(localStorage.getItem('goms:bidGrid:favourites')!)).toEqual([])
  })

  it('Delete bid asks first, and removes the bid', async () => {
    const bid = await makeBid('Alpha')
    await makeBid('Beta')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    renderSheet('bidTracker')
    await screen.findByText('Alpha')
    const alphaRow = () => screen.getAllByTestId('bid-row').find((r) => within(r).queryByText('Alpha'))!
    await userEvent.click(within(alphaRow()).getByRole('button', { name: 'Delete bid' }))
    expect(await repository.getBid(bid.id)).toBeTruthy() // declined
    await userEvent.click(within(alphaRow()).getByRole('button', { name: 'Delete bid' }))
    await waitFor(async () => expect(await repository.getBid(bid.id)).toBeFalsy())
    expect(confirm).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument())
  })

  it('the Archived button sits beside Lock, and archived bids can be unarchived there', async () => {
    const bid = await makeBid('Alpha')
    await repository.archiveBid(bid.id)
    renderSheet('bidTracker')
    await screen.findByTestId('grid-empty')
    const lock = screen.getByRole('button', { name: /Master grid editing/ })
    const archived = screen.getByRole('button', { name: /^Archived/ })
    expect(lock.parentElement).toBe(archived.parentElement)
    expect(archived).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(archived)
    expect(archived).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
    await waitFor(async () => expect((await repository.getBid(bid.id))!.status).toBe('active'))
  })

  it('right-click on a cell offers open, edit, copy, filter, move, favourite, archive and delete', async () => {
    const bid = await makeBid('Alpha')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderSheet('bidTracker')
    await screen.findByText('Alpha')
    const cell = screen.getByText('Alpha').closest('td')!
    fireEvent.contextMenu(cell)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Open details', 'Edit cell (unlock first)', 'Copy value', 'Filter: Opportunity / Mission is this value',
      'Move to Pipeline · Funnel', 'Move to Pipeline · Backup', 'Move to Pipeline · Commits', 'Move to Campaign',
      'Add to favourites', 'Archive', 'Delete bid…',
    ])
    expect(within(menu).getByRole('menuitem', { name: /Edit cell/ })).toBeDisabled()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Copy value' }))
    expect(writeText).toHaveBeenCalledWith('Alpha')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.contextMenu(cell)
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Add to favourites' }))
    expect(JSON.parse(localStorage.getItem('goms:bidGrid:favourites')!)).toEqual([bid.id])

    fireEvent.contextMenu(cell)
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Filter: Opportunity / Mission is this value' }))
    expect(await screen.findByTestId('active-filters')).toHaveTextContent('Opportunity / Mission')

    fireEvent.contextMenu(cell)
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Open details' }))
    expect(await screen.findByText('details page')).toBeInTheDocument()
    expect(bid.id).toBeTruthy()
  })

  it('right-click edits an editable cell when the grid is unlocked, and Escape closes the menu', async () => {
    await makeBid('Alpha')
    renderSheet('bidTracker')
    await screen.findByText('Alpha')
    await unlock()
    const city = document.querySelector('[data-editable-cell][aria-label="Edit City"]')!.closest('td')!
    fireEvent.contextMenu(city)
    const edit = within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Edit cell' })
    expect(edit).toBeEnabled()
    await userEvent.click(edit)
    expect(await screen.findByRole('textbox', { name: 'City' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    fireEvent.contextMenu(screen.getByText('Alpha').closest('td')!)
    await screen.findByRole('menu')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('right-click on a header offers sort, filter, freeze and hide', async () => {
    await makeBid('Alpha')
    renderSheet('bidTracker')
    await screen.findByText('Alpha')
    const th = document.querySelector('th[data-col-id="city"]')!
    fireEvent.contextMenu(th)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Sort ascending', 'Sort descending', 'Clear sort', 'Filter by this column', 'Freeze column', 'Hide column',
    ])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Freeze column' }))
    expect(screen.getByTitle('Frozen column')).toBeInTheDocument()
    fireEvent.contextMenu(th)
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Hide column' }))
    expect(screen.queryByRole('button', { name: 'Sort by City' })).not.toBeInTheDocument()
  })

  it('columns reorder by dragging a row in Manage columns (no arrow buttons)', async () => {
    await makeBid('Alpha')
    renderSheet('bidTracker')
    await screen.findByText('Alpha')
    await userEvent.click(screen.getByRole('button', { name: /^Manage columns/ }))
    const panel = await screen.findByTestId('columns-panel')
    expect(within(panel).queryByRole('button', { name: /^Move / })).not.toBeInTheDocument()
    const rows = within(panel).getAllByTestId('shown-column')
    const rowOf = (name: string) => rows.find((li) => li.textContent?.startsWith(name))!
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const before = leafHeaders()
    expect(before.indexOf('Sector')).toBeGreaterThan(before.indexOf('City'))
    // Drag Sector up past City (not just one step).
    fireEvent.dragStart(rowOf('Sector'), { dataTransfer })
    fireEvent.dragOver(rowOf('State'), { dataTransfer })
    fireEvent.drop(rowOf('State'), { dataTransfer })
    const after = leafHeaders()
    expect(after.indexOf('Sector')).toBe(before.indexOf('State'))
    expect(after.indexOf('Sector')).toBeLessThan(after.indexOf('City'))
  })
})

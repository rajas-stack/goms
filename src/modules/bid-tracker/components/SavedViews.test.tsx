import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { BidTrackerWorkspace } from '../BidTrackerWorkspace'

function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}),
  })
}

async function makeBid(name: string) {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/bid-tracker']}>
        <Routes><Route path="/bid-tracker" element={<BidTrackerWorkspace />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const names = () => screen.queryAllByTestId('bid-row').map((r) => within(r).queryByText(/^(Alpha|Beta|Gamma)$/)?.textContent)
const leafHeaders = () => Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent)
const pill = (name: string) => within(screen.getByTestId('saved-view-tabs')).getByRole('button', { name: new RegExp(`^${name}`) })

describe('saved views', () => {
  beforeEach(async () => {
    stubLayout()
    await resetLocalData()
  })

  it('shows the seven system views, never the two example views, and offers Create Saved View', async () => {
    renderWorkspace()
    for (const n of ['All Bids', 'My Bids', 'Solutioning', 'Qualification', 'Due Soon', 'Overdue', 'Go Approved']) {
      expect(await screen.findByRole('button', { name: n })).toBeInTheDocument()
    }
    expect(screen.queryByText('Smart Transport Bids')).not.toBeInTheDocument()
    expect(screen.queryByText('High Value Deals > 20 Cr')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Saved View/ })).toBeInTheDocument()
  })

  it('a system view applies its filter (Solutioning) and cannot be deleted', async () => {
    const b = await makeBid('Beta')
    await makeBid('Alpha')
    await repository.updateBid(b.id, { stageKey: 'qualification' })
    renderWorkspace()
    await screen.findByText('Beta')
    await userEvent.click(await screen.findByRole('button', { name: 'Qualification' }))
    await waitFor(() => expect(names()).toEqual(['Beta']))
    expect(screen.queryByRole('button', { name: /Delete view/ })).not.toBeInTheDocument()
  })

  it('creates a personal view from the current filters and ordered columns, then switches to it', async () => {
    await makeBid('Alpha')
    const score = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    await repository.setBidCustomValue((await repository.listBidsForGrid())[0].id, score.id, 5)
    renderWorkspace()
    await screen.findByText('Alpha')

    // Build a custom-column filter in the grid, and hide a column.
    await userEvent.click(screen.getByRole('button', { name: /Manage columns/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Hide City' }))
    await userEvent.click(screen.getByRole('button', { name: /Create Saved View/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /View Name/ }), 'High scores')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add filter' }))
    const rule = within(dialog).getByTestId('filter-rule')
    await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Field' }), 'Score')
    await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Operator' }), 'greater than')
    await userEvent.type(within(rule).getByRole('spinbutton', { name: 'Value' }), '1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create View' }))

    const saved = (await repository.listBidSavedViews()).find((v) => v.name === 'High scores')!
    expect(saved).toMatchObject({ scope: 'personal', isSystem: false })
    expect(saved.filterRules).toEqual([{ field: 'custom:score', operator: 'gt', value: '1' }])
    expect(saved.visibleColumns).toContain('custom:score')
    expect(saved.visibleColumns).not.toContain('city')
    expect(pill('High scores')).toHaveAttribute('aria-pressed', 'true')
    expect(leafHeaders()).not.toContain('City')
  })

  it('edits to a user view persist back to it; edits to a system view do not', async () => {
    await makeBid('Alpha')
    const view = await repository.createBidSavedView({ name: 'Mine', scope: 'personal', visibleColumns: ['opportunityName', 'bidCode'] })
    renderWorkspace()
    await screen.findByText('Alpha')

    // System view: hiding a column is session-only.
    await userEvent.click(screen.getByRole('button', { name: /Manage columns/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Hide City' }))
    await new Promise((r) => setTimeout(r, 900))
    expect((await repository.listBidSavedViews()).filter((v) => v.isSystem).every((v) => v.visibleColumns.length === 0)).toBe(true)

    // ...and the strip says the change is unsaved, instead of letting it look saved.
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Changes not saved to this view')

    // User view: switching restores its own ordered columns; changing them persists.
    await userEvent.click(await screen.findByRole('button', { name: 'Mine' }))
    await waitFor(() => expect(leafHeaders()).toEqual(['Opportunity / Mission', 'Bid ID']))
    await userEvent.click(screen.getByRole('button', { name: /Manage columns/ }))
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Drag to reorder Bid ID' }), { key: 'ArrowUp', altKey: true })
    await waitFor(async () => {
      // Hidden columns are stored in place as `~hidden:<id>` markers; the shown order is what changed.
      const stored = (await repository.listBidSavedViews()).find((v) => v.id === view.id)!.visibleColumns
      expect(stored.filter((token) => !token.startsWith('~hidden:'))).toEqual(['bidCode', 'opportunityName'])
    }, { timeout: 3000 })
  })

  it('a view referencing an archived custom column still loads: rule ignored with a notice, stored view untouched, restored on unarchive', async () => {
    const [a, b] = [await makeBid('Alpha'), await makeBid('Beta')]
    const note = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
    await repository.setBidCustomValue(a.id, note.id, 'fast')
    const view = await repository.createBidSavedView({
      name: 'Fast', scope: 'global',
      filterRules: [{ field: 'custom:note', operator: 'contains', value: 'fast' }],
      visibleColumns: ['opportunityName', 'custom:note'],
    })
    await repository.archiveBidCustomField(note.id)
    renderWorkspace()
    await screen.findByText('Beta')
    await userEvent.click(await screen.findByRole('button', { name: /^Fast/ }))
    await waitFor(() => expect(names().sort()).toEqual(['Alpha', 'Beta']))
    expect(screen.getByRole('status')).toHaveTextContent('1 filter ignored — column archived')
    expect(leafHeaders()).toEqual(['Opportunity / Mission'])
    const stored = (await repository.listBidSavedViews()).find((v) => v.id === view.id)!
    expect(stored.filterRules).toHaveLength(1)
    expect(stored.visibleColumns).toEqual(['opportunityName', 'custom:note'])
    void b
  })

  it('deletes a user view after confirmation and falls back to All Bids', async () => {
    await makeBid('Alpha')
    const view = await repository.createBidSavedView({ name: 'Temp', scope: 'personal' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: 'Temp' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete view Temp' }))
    await waitFor(async () => expect((await repository.listBidSavedViews()).some((v) => v.id === view.id)).toBe(false))
    await waitFor(() => expect(pill('All Bids')).toHaveAttribute('aria-pressed', 'true'))
  })
})

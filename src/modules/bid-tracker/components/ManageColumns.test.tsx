import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { MasterGrid, type MasterGridProps } from './MasterGrid'

function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}),
  })
}
async function makeBid(name = 'Alpha') {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}
function renderGrid(props: MasterGridProps = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><MasterGrid {...props} /></MemoryRouter></QueryClientProvider>)
}
const leafHeaders = () => Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent)
const groupHeaders = () => Array.from(document.querySelectorAll('th[scope=colgroup]')).map((th) => th.textContent)
const openColumns = async () => userEvent.click(screen.getByRole('button', { name: /^Manage columns/ }))
const customRow = (name: string) => screen.getAllByTestId('custom-column-row').find((r) => r.textContent?.includes(name))!

async function addColumnViaDialog(name: string, type?: string, options?: string[]) {
  await userEvent.click(screen.getAllByRole('button', { name: /Add column/ })[0])
  const dialog = await screen.findByRole('dialog')
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Column name/ }), name)
  if (type) await userEvent.selectOptions(within(dialog).getByRole('combobox'), type)
  if (options) {
    const boxes = within(dialog).getAllByRole('textbox', { name: /^Option/ })
    for (const [i, o] of options.entries()) {
      if (i >= boxes.length) await userEvent.click(within(dialog).getByRole('button', { name: 'Add option' }))
      await userEvent.type(within(dialog).getAllByRole('textbox', { name: /^Option/ })[i], o)
    }
  }
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add column' }))
  return dialog
}

describe('custom column management', () => {
  beforeEach(async () => {
    stubLayout()
    await resetLocalData()
  })

  it('adds a text column from the grid, shows it in the Custom group, and it is immediately editable', async () => {
    const bid = await makeBid()
    renderGrid()
    await screen.findByText('Alpha')
    await addColumnViaDialog('Client Contact')
    await screen.findByRole('button', { name: 'Sort by Client Contact' })
    expect(groupHeaders()[groupHeaders().length - 1]).toBe('Custom')
    await userEvent.click(screen.getByRole('button', { name: /editing locked/ })) // the grid opens locked
    await userEvent.click(screen.getByRole('button', { name: 'Edit Client Contact' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Client Contact' }), 'Ravi{Enter}')
    await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).client_contact).toBe('Ravi'))
  })

  it('adds a select column with options, and a number column', async () => {
    await makeBid()
    renderGrid()
    await screen.findByText('Alpha')
    await addColumnViaDialog('Tier', 'select', ['Gold', 'Silver'])
    await screen.findByRole('button', { name: 'Sort by Tier' })
    expect((await repository.listBidCustomFields()).find((f) => f.name === 'Tier')).toMatchObject({ dataType: 'select', options: ['Gold', 'Silver'] })
    await addColumnViaDialog('Score', 'number')
    await screen.findByRole('button', { name: 'Sort by Score' })
    expect(leafHeaders().slice(-2)).toEqual(['Tier', 'Score'])
  })

  it('shows the server-side error inline (duplicate name; select with no options) and keeps the dialog open', async () => {
    await makeBid()
    await repository.createBidCustomField({ name: 'Region', dataType: 'text' })
    renderGrid()
    await screen.findByText('Alpha')
    const dup = await addColumnViaDialog(' region ')
    expect(await within(dup).findByRole('alert')).toHaveTextContent(/already exists/)
    await userEvent.click(within(dup).getByRole('button', { name: 'Cancel' }))
    const sel = await addColumnViaDialog('Empty select', 'select')
    expect(await within(sel).findByRole('alert')).toHaveTextContent(/at least one option/)
  })

  it('appends a new column to an explicit view column list, so it is not hidden', async () => {
    await makeBid()
    const onVisibleColumnsChange = vi.fn()
    renderGrid({ visibleColumns: ['opportunityName'], onVisibleColumnsChange })
    await screen.findByText('Alpha')
    await addColumnViaDialog('Note')
    // Hidden columns keep their slots as `~hidden:<id>` markers; the new column is shown right after the shown ones.
    await waitFor(() => expect(onVisibleColumnsChange).toHaveBeenCalled())
    const order = onVisibleColumnsChange.mock.calls[onVisibleColumnsChange.mock.calls.length - 1][0] as string[]
    expect(order.filter((token) => !token.startsWith('~hidden:'))).toEqual(['opportunityName', 'custom:note'])
  })

  it('renames a column (header changes, key and values stay) and edits select options', async () => {
    const bid = await makeBid()
    const tier = await repository.createBidCustomField({ name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
    await repository.setBidCustomValue(bid.id, tier.id, 'Gold')
    renderGrid()
    await screen.findByText('Alpha')
    await openColumns()
    await userEvent.click(within(customRow('Tier')).getByRole('button', { name: 'Rename Tier' }))
    const input = screen.getByRole('textbox', { name: 'New name for Tier' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Level{Enter}')
    await screen.findByRole('button', { name: 'Sort by Level' })
    expect((await repository.listBidCustomFields())[0]).toMatchObject({ name: 'Level', key: 'tier' })
    expect(await repository.listBidCustomValues(bid.id)).toEqual({ tier: 'Gold' })

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(within(customRow('Level')).getByRole('button', { name: 'Edit options for Level' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove option 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add option' }))
    await userEvent.type(screen.getAllByRole('textbox', { name: /^Option/ })[1], 'Bronze')
    await userEvent.click(screen.getByRole('button', { name: 'Save options' }))
    await waitFor(async () => expect((await repository.listBidCustomFields())[0].options).toEqual(['Gold', 'Bronze']))
  })

  it('reorders columns by default order', async () => {
    await makeBid()
    await repository.createBidCustomField({ name: 'First', dataType: 'text' })
    await repository.createBidCustomField({ name: 'Second', dataType: 'text' })
    renderGrid()
    await screen.findByText('Alpha')
    expect(leafHeaders().slice(-2)).toEqual(['First', 'Second'])
    await openColumns()
    await userEvent.click(within(customRow('Second')).getByRole('button', { name: 'Move Second earlier by default' }))
    await waitFor(() => expect(leafHeaders().slice(-2)).toEqual(['Second', 'First']))
  })

  it('archives a column (values kept, gone from the grid) and restores it', async () => {
    const bid = await makeBid()
    const score = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    await repository.setBidCustomValue(bid.id, score.id, 7)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderGrid()
    await screen.findByText('Alpha')
    await openColumns()
    await userEvent.click(within(customRow('Score')).getByRole('button', { name: 'Archive Score' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sort by Score' })).not.toBeInTheDocument())
    expect(groupHeaders()).not.toContain('Custom')
    const archivedRow = await screen.findByTestId('archived-column-row')
    await userEvent.click(within(archivedRow).getByRole('button', { name: 'Restore Score' }))
    await screen.findByRole('button', { name: 'Sort by Score' })
    expect(await repository.listBidCustomValues(bid.id)).toEqual({ score: 7 })
  })

  it('shows no custom-columns section (heading or hint) until there is a custom column to manage', async () => {
    await makeBid()
    renderGrid()
    await screen.findByText('Alpha')
    await openColumns()
    const panel = await screen.findByTestId('manage-columns-panel')
    expect(within(panel).queryByText(/Custom columns/)).not.toBeInTheDocument()
    expect(within(panel).queryByText(/None yet/)).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /Add column/ })).not.toBeInTheDocument()
    // The one Add column control is the toolbar button.
    expect(screen.getAllByRole('button', { name: /Add column/ })).toHaveLength(1)
  })

  it('hides and shows a custom column from the same panel', async () => {
    await makeBid()
    await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    renderGrid()
    await screen.findByRole('button', { name: 'Sort by Score' })
    await openColumns()
    await userEvent.click(screen.getByRole('button', { name: 'Hide Score' }))
    expect(screen.queryByRole('button', { name: 'Sort by Score' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show Score' }))
    expect(await screen.findByRole('button', { name: 'Sort by Score' })).toBeInTheDocument()
  })

  it('hiding and showing a middle column preserves every column slot', async () => {
    await makeBid()
    await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    renderGrid({ visibleColumns: ['opportunityName', 'custom:score', 'bidCode', 'city'] })
    await screen.findByRole('button', { name: 'Sort by Score' })
    const originalOrder = leafHeaders()
    await openColumns()

    await userEvent.click(screen.getByRole('button', { name: 'Hide Score' }))
    expect(screen.queryByRole('button', { name: 'Sort by Score' })).not.toBeInTheDocument()
    expect(leafHeaders()).toEqual(originalOrder.filter((header) => header !== 'Score'))

    await userEvent.click(screen.getByRole('button', { name: 'Show Score' }))
    await screen.findByRole('button', { name: 'Sort by Score' })
    expect(leafHeaders()).toEqual(originalOrder)
  })

  it('Delete is offered for every custom column; one holding values asks for a stronger confirmation and removes them too', async () => {
    const bid = await makeBid()
    const used = await repository.createBidCustomField({ name: 'Used', dataType: 'text' })
    await repository.createBidCustomField({ name: 'Fresh', dataType: 'text' })
    await repository.setBidCustomValue(bid.id, used.id, 'x')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderGrid()
    await screen.findByRole('button', { name: 'Sort by Fresh' })
    await openColumns()
    await userEvent.click(within(customRow('Fresh')).getByRole('button', { name: 'Delete Fresh' }))
    await waitFor(async () => expect((await repository.listBidCustomFields(true)).map((f) => f.name)).toEqual(['Used']))
    expect(confirm.mock.calls[0][0]).toMatch(/nothing is lost/)
    await userEvent.click(within(customRow('Used')).getByRole('button', { name: 'Delete Used' }))
    expect(confirm.mock.calls[1][0]).toMatch(/Every value in it is deleted too/)
    await waitFor(async () => expect(await repository.listBidCustomFields(true)).toEqual([]))
    expect(await repository.listBidCustomValues(bid.id)).toEqual({})
    const log = await repository.listAuditLogs({ entityType: 'bidCustomField' })
    expect(log.find((l) => l.action === 'custom_field_deleted' && l.oldValue === 'Used')?.reason).toBe('Deleted with 1 value')
  })

  it('cancelling the confirmation deletes nothing, and an archived column can be deleted too', async () => {
    const bid = await makeBid()
    const used = await repository.createBidCustomField({ name: 'Used', dataType: 'text' })
    await repository.setBidCustomValue(bid.id, used.id, 'x')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderGrid()
    await screen.findByRole('button', { name: 'Sort by Used' })
    await openColumns()
    await userEvent.click(within(customRow('Used')).getByRole('button', { name: 'Delete Used' }))
    expect((await repository.listBidCustomFields(true)).length).toBe(1)
    confirm.mockReturnValue(true)
    await userEvent.click(within(customRow('Used')).getByRole('button', { name: 'Archive Used' }))
    const archivedRow = await screen.findByTestId('archived-column-row')
    await userEvent.click(within(archivedRow).getByRole('button', { name: 'Delete Used' }))
    await waitFor(async () => expect(await repository.listBidCustomFields(true)).toEqual([]))
  })

  it('every column in the Shown list has Delete: default ones leave the grid (restorable), custom ones are deleted', async () => {
    await makeBid()
    await repository.createBidCustomField({ name: 'Fresh', dataType: 'text' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderGrid()
    await screen.findByRole('button', { name: 'Sort by Fresh' })
    await openColumns()
    const panel = await screen.findByTestId('columns-panel')
    const rows = within(panel).getAllByTestId('shown-column')
    for (const row of rows) expect(within(row).getByRole('button', { name: /^Delete / })).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Delete City' }))
    expect(screen.queryByRole('button', { name: 'Sort by City' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Show City' })).toBeInTheDocument() // restorable
    await userEvent.click(within(panel).getByRole('button', { name: 'Delete Fresh' }))
    await waitFor(async () => expect(await repository.listBidCustomFields(true)).toEqual([]))
  })
})

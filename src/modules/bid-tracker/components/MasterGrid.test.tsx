import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { TypedFilterRule } from '@goms/domain'
import { repository, resetLocalData } from '@/data/repository'
import { MasterGrid, type MasterGridProps } from './MasterGrid'

// Real in-memory repository + real hooks (the same pattern as
// SalesPersonFormDialog.test.tsx): the grid, the typed filters and the custom
// column model are exercised end to end, not against mocked hook return values.
async function makeBid(name: string, extra: { city?: string; submissionDate?: string } = {}) {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15', ...extra })
  return repository.createBid(opp.id)
}

function renderGrid(props: MasterGridProps = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><MasterGrid {...props} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const rowNames = () => screen.queryAllByTestId('bid-row').map((r) => within(r).queryByText(/^(Alpha|Beta|Gamma|Delta|Epsilon)$/)?.textContent)
const groupHeaders = () => Array.from(document.querySelectorAll('th[scope=colgroup]')).map((th) => th.textContent)
// The grid opens LOCKED; unlocking is what turns editable cells into editors.
const unlock = async () => userEvent.click(await screen.findByRole('button', { name: /editing locked/ }))
const openPopover = async (name: string) => userEvent.click(screen.getByRole('button', { name: new RegExp(name) }))

const STANDARD_GROUPS = ['Identity', 'Client', 'Ownership', 'Decision', 'Dates', 'Documents', 'System']
const REQUIRED_LEAVES: Record<string, string[]> = {
  Identity: ['Opportunity ID', 'Opportunity / Mission', 'Bid ID', 'Tender ID', 'Tender Link'],
  Client: ['Department / Client', 'State', 'City', 'Sector'],
  Ownership: ['Bid Owner', 'Sales Lead / Solution Lead'],
  Decision: ['Bid Stage', 'Next Action', 'Action Owner', 'Action Due', 'Attention', 'Decision'],
  Dates: ['Next Milestone', 'Days Remaining', 'Submission Deadline'],
  Documents: ['Tender Files', 'Latest Corrigendum'],
  System: ['Last Updated', 'Updated By', 'Data Confidence', 'Manage'],
}

// jsdom lays nothing out: every element measures 0x0, so @tanstack/react-virtual
// would see a zero-height scroll window and render no rows. Give elements a
// realistic size so the virtualizer has a window to render (real-browser
// scroll behaviour is verified manually — see the task's verification notes).
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}),
  })
}

describe('MasterGrid', () => {
  beforeEach(async () => {
    stubLayout()
    await resetLocalData()
  })

  describe('column completeness (spec §8)', () => {
    it('renders all seven required groups, in order, with every required leaf column — and no Custom group without custom columns', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      expect(groupHeaders()).toEqual(STANDARD_GROUPS)

      const leafHeaders = Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent?.replace(/Filtered$/, '').trim())
      expect(leafHeaders).toEqual(Object.values(REQUIRED_LEAVES).flat())
      // Each leaf sits under its own group (group colSpans match the leaf counts).
      const spans = Array.from(document.querySelectorAll<HTMLTableCellElement>('th[scope=colgroup]')).map((th) => th.colSpan)
      expect(spans).toEqual(Object.values(REQUIRED_LEAVES).map((l) => l.length))
    })

    it('shows the Custom group after the seven required groups, built from the field definitions', async () => {
      await makeBid('Alpha')
      await repository.createBidCustomField({ name: 'Region Score', dataType: 'number' })
      await repository.createBidCustomField({ name: 'Priority', dataType: 'select', options: ['Hot', 'Cold'] })
      renderGrid()
      await screen.findByText('Alpha')
      await screen.findByRole('button', { name: 'Sort by Region Score' })
      expect(groupHeaders()).toEqual([...STANDARD_GROUPS, 'Custom'])
      const leafs = Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent)
      expect(leafs.slice(-2)).toEqual(['Region Score', 'Priority'])
    })

    it('drops an archived custom column and restores it on unarchive', async () => {
      await makeBid('Alpha')
      const f = await repository.createBidCustomField({ name: 'Region Score', dataType: 'number' })
      await repository.archiveBidCustomField(f.id)
      const view = renderGrid()
      await screen.findByText('Alpha')
      expect(screen.queryByRole('button', { name: 'Sort by Region Score' })).not.toBeInTheDocument()
      expect(groupHeaders()).toEqual(STANDARD_GROUPS)
      view.unmount()
      await repository.unarchiveBidCustomField(f.id)
      renderGrid()
      expect(await screen.findByRole('button', { name: 'Sort by Region Score' })).toBeInTheDocument()
    })
  })

  describe('row data', () => {
    it('shows city, owner-facing fields and the Action Owner from the next open action', async () => {
      const bid = await makeBid('Alpha', { city: 'New Delhi' })
      const person = await repository.createSalesPerson({ name: 'Action Person', officialEmail: 'action@amnex.com', designation: 'RM', tierKey: 'rm' })
      await repository.createFollowUp({ entityType: 'bid', entityId: bid.id, dueDate: '2099-02-01', note: 'Confirm EMD', assigneeId: person.id })
      renderGrid()
      const row = (await screen.findByText('Alpha')).closest('tr')!
      expect(within(row).getByText('New Delhi')).toBeInTheDocument()
      expect(within(row).getByText('Confirm EMD')).toBeInTheDocument()
      expect(within(row).getByText('action@amnex.com')).toBeInTheDocument()
      expect(within(row).getByText('2099-02-01')).toBeInTheDocument()
      expect(within(row).getByText('On Track')).toBeInTheDocument()
      expect(within(row).getByText('Solutioning')).toBeInTheDocument()
    })

    it('archives and unarchives from the Manage column without navigating', async () => {
      const bid = await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
      await screen.findByRole('button', { name: 'Unarchive' })
      expect((await repository.getBid(bid.id))!.status).toBe('archived')
      await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
      await screen.findByRole('button', { name: 'Archive' })
    })
  })

  describe('inline editing', () => {
    it('edits a custom cell in place: Enter commits, and the value is persisted', async () => {
      const bid = await makeBid('Alpha')
      const score = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
      renderGrid()
      await unlock()
      await screen.findByText('Alpha')
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Score' }))
      await userEvent.type(screen.getByRole('spinbutton', { name: 'Score' }), '42{Enter}')
      await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).score).toBe(42))
      expect(await screen.findByText('42')).toBeInTheDocument()
      void score
    })

    it('Escape cancels without writing', async () => {
      const bid = await makeBid('Alpha')
      await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
      renderGrid()
      await unlock()
      await screen.findByText('Alpha')
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Note' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), 'draft{Escape}')
      expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
      expect(await repository.listBidCustomValues(bid.id)).toEqual({})
    })

    it('clearing a value removes it', async () => {
      const bid = await makeBid('Alpha')
      const note = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
      await repository.setBidCustomValue(bid.id, note.id, 'hello')
      renderGrid()
      await unlock()
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Note' }))
      const box = screen.getByRole('textbox', { name: 'Note' })
      await userEvent.clear(box)
      await userEvent.type(box, '{Enter}')
      await waitFor(async () => expect(await repository.listBidCustomValues(bid.id)).toEqual({}))
    })

    it('edits a select cell from the field\'s current options and tags a removed option', async () => {
      const bid = await makeBid('Alpha')
      const tier = await repository.createBidCustomField({ name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
      await repository.setBidCustomValue(bid.id, tier.id, 'Silver')
      await repository.updateBidCustomField(tier.id, { options: ['Gold'] })
      renderGrid()
      await unlock()
      await screen.findByText('Silver (removed)')
      await userEvent.click(screen.getByRole('button', { name: 'Edit Tier' }))
      const list = await screen.findByRole('listbox', { name: 'Tier' })
      expect(within(list).getByRole('option', { name: 'Silver (removed option)' })).toBeInTheDocument()
      await userEvent.click(within(list).getByRole('option', { name: 'Gold' }))
      await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).tier).toBe('Gold'))
    })

    it('rolls back and shows an inline error when the save is rejected', async () => {
      await makeBid('Alpha')
      await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
      vi.spyOn(repository, 'setBidCustomValue').mockRejectedValueOnce(new Error('Server said no'))
      renderGrid()
      await unlock()
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Note' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), 'oops{Enter}')
      expect(await screen.findByText('Server said no')).toBeInTheDocument()
      expect(screen.queryByText('oops')).not.toBeInTheDocument()
    })

    it('edits City (a plain opportunity attribute) inline', async () => {
      const bid = await makeBid('Alpha')
      renderGrid()
      await unlock()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'Edit City' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'City' }), 'Pune{Enter}')
      await waitFor(async () => expect((await repository.getOpportunity((await repository.getBid(bid.id))!.opportunityId))?.city).toBe('Pune'))
      expect(await screen.findByText('Pune')).toBeInTheDocument()
    })

    it('leaves protected, corrigendum-tracked and workflow-governed columns read-only', async () => {
      await makeBid('Alpha')
      renderGrid()
      await unlock()
      await screen.findByText('Alpha')
      for (const header of ['Tender ID', 'Submission Deadline', 'Department / Client', 'State', 'Next Action', 'Opportunity ID', 'Bid ID']) {
        expect(screen.queryByRole('button', { name: `Edit ${header}` })).not.toBeInTheDocument()
      }
    })
  })

  describe('sorting', () => {
    it('sorts numbers numerically, with empty values last in both directions', async () => {
      const [a, b, c] = [await makeBid('Alpha'), await makeBid('Beta'), await makeBid('Gamma')]
      await makeBid('Delta')
      const score = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
      await repository.setBidCustomValue(a.id, score.id, 9)
      await repository.setBidCustomValue(b.id, score.id, 10)
      await repository.setBidCustomValue(c.id, score.id, 100)
      renderGrid()
      await screen.findByText('Alpha')
      const sort = await screen.findByRole('button', { name: 'Sort by Score' })
      await userEvent.click(sort)
      expect(rowNames()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']) // 9, 10, 100 — not lexical (10 < 9) — then empty
      await userEvent.click(sort)
      expect(rowNames()).toEqual(['Gamma', 'Beta', 'Alpha', 'Delta'])
    })

    it('sorts dates chronologically and text case-insensitively', async () => {
      const a = await makeBid('Alpha'); const b = await makeBid('Beta')
      const due = await repository.createBidCustomField({ name: 'Review', dataType: 'date' })
      await repository.setBidCustomValue(a.id, due.id, '2026-12-25')
      await repository.setBidCustomValue(b.id, due.id, '2026-02-01')
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(await screen.findByRole('button', { name: 'Sort by Review' }))
      expect(rowNames()).toEqual(['Beta', 'Alpha'])
      await userEvent.click(screen.getByRole('button', { name: 'Sort by Opportunity / Mission' }))
      expect(rowNames()).toEqual(['Alpha', 'Beta'])
    })
  })

  describe('filtering', () => {
    async function seedScores() {
      const [a, b, c] = [await makeBid('Alpha'), await makeBid('Beta'), await makeBid('Gamma')]
      const score = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
      const note = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
      await repository.setBidCustomValue(a.id, score.id, 9)
      await repository.setBidCustomValue(b.id, score.id, 10)
      await repository.setBidCustomValue(c.id, score.id, 100)
      await repository.setBidCustomValue(a.id, note.id, 'Fast track')
    }

    async function addRule(field: string, operator: string, value?: string) {
      await userEvent.click(screen.getByRole('button', { name: 'Add filter' }))
      const rule = (() => { const all = screen.getAllByTestId('filter-rule'); return all[all.length - 1] })()
      await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Field' }), field)
      await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Operator' }), operator)
      if (value !== undefined) {
        const box = within(rule).queryByRole('textbox', { name: 'Value' }) ?? within(rule).getByRole('spinbutton', { name: 'Value' })
        await userEvent.type(box, value)
      }
      return rule
    }

    it('offers only the operators that fit the chosen column type', async () => {
      await seedScores()
      renderGrid()
      await screen.findByText('Alpha')
      await openPopover('Filters')
      const rule = await addRule('Score', 'greater than')
      const operators = (r: HTMLElement) => within(within(r).getByRole('combobox', { name: 'Operator' })).getAllByRole('option').map((o) => o.textContent)
      expect(operators(rule)).toEqual(['equals', 'greater than', 'less than', 'between'])
      await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Field' }), 'Note')
      expect(operators(rule)).toEqual(['contains', 'equals', 'starts with'])
      await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Field' }), 'Submission Deadline')
      expect(operators(rule)).toEqual(['before', 'after', 'between'])
      await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Field' }), 'Bid Stage')
      expect(operators(rule)).toEqual(['equals', 'is one of'])
    })

    it('filters a custom number column numerically (WHERE Score > 9)', async () => {
      await seedScores()
      renderGrid()
      await screen.findByText('Alpha')
      await openPopover('Filters')
      await addRule('Score', 'greater than', '9')
      await waitFor(() => expect(rowNames()).toEqual(['Beta', 'Gamma']))
      expect(screen.getByTestId('active-filters')).toHaveTextContent('Score greater than 9')
    })

    it('combines several filters at once (AND), including standard and custom columns', async () => {
      await seedScores()
      renderGrid()
      await screen.findByText('Alpha')
      await openPopover('Filters')
      await addRule('Score', 'between')
      const rule = screen.getAllByTestId('filter-rule')[0]
      await userEvent.type(within(rule).getByRole('spinbutton', { name: 'From' }), '9')
      await userEvent.type(within(rule).getByRole('spinbutton', { name: 'To' }), '10')
      await waitFor(() => expect(rowNames()).toEqual(['Alpha', 'Beta']))
      await addRule('Opportunity / Mission', 'starts with', 'be')
      await waitFor(() => expect(rowNames()).toEqual(['Beta']))
      expect(screen.getAllByTestId('filter-rule')).toHaveLength(2)
    })

    it('an incomplete rule does not blank the grid, and shows as a draft condition', async () => {
      await seedScores()
      renderGrid()
      await screen.findByText('Alpha')
      await openPopover('Filters')
      await addRule('Score', 'greater than') // no value yet
      expect(rowNames().sort()).toEqual(['Alpha', 'Beta', 'Gamma'])
      expect(screen.getByTestId('active-filters')).toHaveTextContent('Score greater than choose a value')
    })

    it('shows each condition as an editable WHERE chip, and Add condition opens a new one', async () => {
      await seedScores()
      renderGrid({ filterRules: [{ field: 'custom:score', operator: 'gt', value: '9' }] })
      await screen.findByText('Beta')
      const bar = screen.getByTestId('active-filters')
      expect(bar).toHaveTextContent('Where')
      expect(bar).toHaveTextContent('Score greater than 9')
      await userEvent.click(within(bar).getByRole('button', { name: 'Edit filter Score greater than 9' }))
      expect(await screen.findByTestId('filter-builder')).toBeInTheDocument()
      await userEvent.click(within(bar).getByRole('button', { name: /Add condition/ }))
      // The new, still-empty condition shows as a draft chip and its editor is open.
      await waitFor(() => expect(screen.getAllByTestId('filter-rule')).toHaveLength(2))
      expect(within(bar).getAllByRole('button', { name: /^Edit filter/ })).toHaveLength(2)
    })

    it('"Filter by this column" in a header menu starts a condition on that column', async () => {
      await seedScores()
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'Note column menu' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Filter by this column' }))
      const rule = await screen.findByTestId('filter-rule')
      expect(within(rule).getByRole('combobox', { name: 'Field' })).toHaveValue('custom:note')
    })

    it('clears one filter from its chip, and all filters at once', async () => {
      await seedScores()
      renderGrid()
      await screen.findByText('Alpha')
      await openPopover('Filters')
      await addRule('Score', 'greater than', '9')
      await addRule('Note', 'contains', 'fast')
      await waitFor(() => expect(rowNames()).toEqual([]))
      await userEvent.click(screen.getByRole('button', { name: 'Clear filter Note contains fast' }))
      await waitFor(() => expect(rowNames()).toEqual(['Beta', 'Gamma']))
      const clearAll = screen.getAllByRole('button', { name: 'Clear all filters' })[0]
      await userEvent.click(clearAll)
      await waitFor(() => expect(rowNames()).toHaveLength(3))
      expect(screen.queryByTestId('active-filters')).not.toBeInTheDocument()
    })

    it('marks a filtered column in its header', async () => {
      await seedScores()
      renderGrid({ filterRules: [{ field: 'custom:score', operator: 'gt', value: '9' }] })
      await screen.findByText('Beta')
      const header = screen.getByRole('button', { name: 'Sort by Score' }).closest('th')!
      expect(within(header).getByText('Filtered')).toBeInTheDocument()
    })

    it('ignores a rule on an archived custom column with a notice, and applies the rest', async () => {
      await seedScores()
      const rules: TypedFilterRule[] = [
        { field: 'custom:gone', operator: 'eq', value: 'x' },
        { field: 'custom:score', operator: 'gt', value: '9' },
      ]
      renderGrid({ filterRules: rules, onFilterRulesChange: () => {} })
      await waitFor(() => expect(rowNames()).toEqual(['Beta', 'Gamma']))
      expect(screen.getByRole('status')).toHaveTextContent('1 filter ignored — column archived')
    })
  })

  describe('search', () => {
    it('matches text and select values across standard and custom columns, case-insensitively', async () => {
      const a = await makeBid('Alpha', { city: 'Pune' }); await makeBid('Beta')
      const note = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
      const tier = await repository.createBidCustomField({ name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
      await repository.setBidCustomValue(a.id, note.id, 'Fast Track')
      await repository.setBidCustomValue(a.id, tier.id, 'Gold')
      renderGrid()
      await screen.findByText('Beta')
      const box = screen.getByRole('searchbox', { name: 'Search bids' })
      await userEvent.type(box, 'FAST')
      expect(rowNames()).toEqual(['Alpha'])
      await userEvent.clear(box); await userEvent.type(box, 'gold')
      expect(rowNames()).toEqual(['Alpha'])
      await userEvent.clear(box); await userEvent.type(box, 'pune')
      expect(rowNames()).toEqual(['Alpha'])
      await userEvent.clear(box); await userEvent.type(box, 'zzz')
      expect(screen.getByTestId('grid-empty')).toHaveTextContent('No bids match')
    })

    it('does not search hidden columns', async () => {
      const a = await makeBid('Alpha'); await makeBid('Beta')
      const note = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
      await repository.setBidCustomValue(a.id, note.id, 'needle')
      renderGrid({ visibleColumns: ['opportunityName'], onVisibleColumnsChange: () => {} })
      await screen.findByText('Beta')
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search bids' }), 'needle')
      expect(screen.getByTestId('grid-empty')).toBeInTheDocument()
    })
  })

  describe('column visibility and order', () => {
    it('honours an ordered visibleColumns list (order = display order, absence = hidden), standard and custom together', async () => {
      await makeBid('Alpha')
      await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
      renderGrid({ visibleColumns: ['custom:score', 'opportunityName', 'bidCode'], onVisibleColumnsChange: () => {} })
      await screen.findByText('Alpha')
      const leafs = Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent)
      expect(leafs).toEqual(['Score', 'Opportunity / Mission', 'Bid ID'])
      expect(groupHeaders()).toEqual(['Custom', 'Identity'])
    })

    it('ignores an unknown/archived id in visibleColumns without touching the rest', async () => {
      await makeBid('Alpha')
      renderGrid({ visibleColumns: ['opportunityName', 'custom:gone', 'city'], onVisibleColumnsChange: () => {} })
      await screen.findByText('Alpha')
      expect(Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent)).toEqual(['Opportunity / Mission', 'City'])
    })

    it('hides, shows and reorders columns from the Columns panel', async () => {
      await makeBid('Alpha')
      await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
      renderGrid()
      await screen.findByText('Alpha')
      await screen.findByRole('button', { name: 'Sort by Score' })
      await openPopover('Manage columns')
      await userEvent.click(screen.getByRole('button', { name: 'Hide City' }))
      expect(screen.queryByRole('button', { name: 'Edit City' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Sort by City' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Show City' }))
      const leafs = () => Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent)
      expect(leafs()[leafs().length - 1]).toBe('City') // shown again at the end
      await userEvent.click(screen.getByRole('button', { name: 'Move City up' }))
      expect(leafs()[leafs().length - 2]).toBe('City')
    })

    it('keeps the header menu to quick actions: no Move or Remove, which live only in the Columns panel', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'Sector column menu' }))
      const items = screen.getAllByRole('menuitem').map((m) => m.textContent?.trim())
      expect(items).toEqual(['Sort ascending', 'Sort descending', 'Filter by this column', 'Freeze column'])
    })

    it('Manage columns in the toolbar hides and restores a column; the header menu has no Manage item', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'Sector column menu' }))
      expect(screen.queryByRole('menuitem', { name: /Manage column/ })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Sector column menu' }))
      await openPopover('Manage columns')
      const panel = await screen.findByTestId('columns-panel')
      const row = within(panel).getAllByTestId('shown-column').find((li) => li.textContent?.startsWith('Sector'))!
      await userEvent.click(within(row).getByRole('button', { name: 'Hide Sector' }))
      expect(screen.queryByRole('button', { name: 'Sort by Sector' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Show Sector' }))
      expect(screen.getByRole('button', { name: 'Sort by Sector' })).toBeInTheDocument()
    })

    it('moves a column from the Columns panel, reporting the new order', async () => {
      await makeBid('Alpha')
      const onVisibleColumnsChange = vi.fn()
      renderGrid({ visibleColumns: ['opportunityName', 'bidCode', 'city'], onVisibleColumnsChange })
      await screen.findByText('Alpha')
      await openPopover('Manage columns')
      await userEvent.click(screen.getByRole('button', { name: 'Move City up' }))
      expect(onVisibleColumnsChange).toHaveBeenCalledWith(['opportunityName', 'city', 'bidCode'])
    })

    it('never hides the last remaining column (an empty list would mean "show everything")', async () => {
      await makeBid('Alpha')
      renderGrid({ visibleColumns: ['bidCode'], onVisibleColumnsChange: () => {} })
      await screen.findByRole('button', { name: 'Sort by Bid ID' })
      await openPopover('Manage columns')
      expect(screen.getByRole('button', { name: 'Hide Bid ID' })).toBeDisabled()
    })

    it('has a single Add column control: the toolbar button, not a second one inside the Columns panel', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await openPopover('Manage columns')
      expect(screen.getAllByRole('button', { name: /Add column/ })).toHaveLength(1)
    })

    it('reports ordered visible ids when controlled', async () => {
      await makeBid('Alpha')
      const onVisibleColumnsChange = vi.fn()
      renderGrid({ visibleColumns: ['opportunityName', 'bidCode'], onVisibleColumnsChange })
      await screen.findByText('Alpha')
      await openPopover('Manage columns')
      await userEvent.click(screen.getByRole('button', { name: 'Move Bid ID up' }))
      expect(onVisibleColumnsChange).toHaveBeenCalledWith(['bidCode', 'opportunityName'])
    })
  })

  describe('virtualization', () => {
    it('renders a window of rows between two single-cell colSpan spacer rows that reserve the rest of the height', async () => {
      for (let i = 0; i < 80; i += 1) await makeBid(`Bid ${i}`)
      renderGrid()
      await screen.findByText('Bid 0')
      const rendered = screen.getAllByTestId('bid-row').length
      expect(rendered).toBeGreaterThan(0)
      expect(rendered).toBeLessThan(80)
      // +1: the leading selection column lives in the first header row (rowSpan 2).
      const columnCount = document.querySelectorAll('thead tr:nth-child(2) th').length + 1
      const spacers = Array.from(document.querySelectorAll('tbody tr[aria-hidden="true"]'))
      expect(spacers).toHaveLength(2) // above the window, below the window
      for (const spacer of spacers) {
        expect(spacer.children).toHaveLength(1)
        expect(spacer.children[0].tagName).toBe('TD')
        expect((spacer.children[0] as HTMLTableCellElement).colSpan).toBe(columnCount)
      }
      // The trailing spacer holds the unrendered remainder, so scroll height stays correct.
      expect(parseInt((spacers[1].children[0] as HTMLElement).style.height, 10)).toBeGreaterThan(0)
    })
  })

  it('shows an empty state when there are no bids', async () => {
    renderGrid()
    expect(await screen.findByTestId('grid-empty')).toHaveTextContent('No bids yet.')
    fireEvent.click(document.body)
  })

  it('has a Create Bid button that opens the opportunity picker', async () => {
    await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Unbid Opportunity', submissionDate: '2099-01-15' })
    renderGrid()
    await screen.findByTestId('grid-empty')
    await userEvent.click(screen.getAllByRole('button', { name: /Create Bid/ })[0])
    expect(await screen.findByRole('dialog', { name: /Create Bid/ })).toBeInTheDocument()
    expect(await screen.findByText('Unbid Opportunity')).toBeInTheDocument()
  })

  it('disables Select all when there are no rows to select', async () => {
    renderGrid()
    await screen.findByTestId('grid-empty')
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeDisabled()
  })

  describe('selection and bulk actions', () => {
    it('shows the bulk toolbar only when rows are selected, and Archive Selected archives exactly those rows', async () => {
      const a = await makeBid('Alpha')
      await makeBid('Beta')
      renderGrid()
      await screen.findByText('Alpha')
      expect(screen.queryByRole('button', { name: /archive selected/i })).not.toBeInTheDocument()
      const row = screen.getByText('Alpha').closest('tr')!
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Select row' }))
      expect(screen.getByText('1 selected')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /archive selected/i }))
      await waitFor(async () => {
        const grid = await repository.listBidsForGrid()
        expect(grid.find((r) => r.id === a.id)?.status).toBe('archived')
        expect(grid.filter((r) => r.status === 'archived')).toHaveLength(1)
      })
      await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument())
    })

    it('Select all selects every visible row', async () => {
      await makeBid('Alpha')
      await makeBid('Beta')
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
      expect(screen.getByText('2 selected')).toBeInTheDocument()
    })

    it('Reassign Owner assigns the chosen sales person to every selected bid', async () => {
      const a = await makeBid('Alpha')
      const person = await repository.createSalesPerson({ name: 'Rita Rao', officialEmail: 'rita@amnex.com', designation: 'RM', tierKey: 'rm' })
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('checkbox', { name: 'Select row' }))
      await userEvent.click(screen.getByRole('button', { name: /reassign owner/i }))
      await userEvent.click(await screen.findByRole('combobox'))
      await userEvent.click(await screen.findByText('Rita Rao'))
      await waitFor(async () => {
        const owners = await repository.resolveOwners('bid', [a.id], new Date().toISOString().slice(0, 10))
        expect(JSON.stringify(owners)).toContain(person.id)
      })
      // The grid itself must refresh (owner is resolved server-side), not just the ledger.
      expect(await screen.findByText('rita@amnex.com')).toBeInTheDocument()
    })
  })
})

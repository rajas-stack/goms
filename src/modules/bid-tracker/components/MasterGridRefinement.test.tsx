import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { MasterGrid, type MasterGridProps } from './MasterGrid'

// The Master Grid refinement: toolbar order, Lock / Unlock, per-column freeze,
// the structured / entity-backed column types, and grouped AND / OR filters —
// against the real in-memory repository and real hooks.
async function makeBid(name: string) {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
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

function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}),
  })
}

const rowNames = () => screen.queryAllByTestId('bid-row').map((r) => within(r).queryByText(/^(Alpha|Beta|Gamma|Delta)$/)?.textContent)
const leafHeaders = () => Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent?.replace('Frozen', ''))
const lockSwitch = () => screen.getByRole('button', { name: /Master grid editing (locked|unlocked)/ })
const unlock = async () => userEvent.click(await screen.findByRole('button', { name: /editing locked/ }))
const leafTh = (name: string) => document.querySelector(`thead th[data-col-id="${name}"]`) as HTMLElement
const bidWithColumn = async (type: Parameters<typeof repository.createBidCustomField>[0]['dataType'], name: string, options?: string[]) => {
  const bid = await makeBid('Alpha')
  const field = await repository.createBidCustomField({ name, dataType: type, ...(options ? { options } : {}) })
  return { bid, field }
}

describe('Master Grid refinement', () => {
  beforeEach(async () => {
    stubLayout()
    localStorage.clear()
    await resetLocalData()
  })

  describe('toolbar', () => {
    it('reads Search / Filters / Add column → Lock → Columns → Create Bid, with Columns only once', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      const toolbar = screen.getByRole('searchbox', { name: 'Search bids' }).closest('div[class*="border-b"]')!
      const labels = Array.from(toolbar.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
      const at = (re: RegExp) => labels.findIndex((l) => re.test(l ?? ''))
      expect(at(/^Filters/)).toBeGreaterThanOrEqual(0)
      expect(at(/Add column/)).toBeGreaterThan(at(/^Filters/))
      expect(at(/Master grid editing/)).toBeGreaterThan(at(/Add column/))
      expect(at(/^Columns/)).toBeGreaterThan(at(/Master grid editing/))
      expect(at(/Create Bid/)).toBeGreaterThan(at(/^Columns/))
      expect(labels.filter((l) => /^Columns/.test(l ?? ''))).toHaveLength(1)
      // Columns sits in the right-hand cluster with Create Bid.
      const cluster = screen.getByRole('button', { name: /Create Bid/ }).parentElement!
      expect(within(cluster).getByRole('button', { name: /^Columns/ })).toBeInTheDocument()
      expect(within(cluster).getByRole('button', { name: /Master grid editing/ })).toBeInTheDocument()
    })

    it('no longer shows the Editable / Read-only legend, the cell hint or the bid count', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      expect(screen.queryByText(/Click a cell to edit/)).not.toBeInTheDocument()
      expect(screen.queryByText('Read-only')).not.toBeInTheDocument()
      expect(screen.queryByText('Editable')).not.toBeInTheDocument()
      expect(screen.queryByText(/\d+ bids?$/)).not.toBeInTheDocument()
    })
  })

  describe('lock / unlock', () => {
    it('starts locked: no cell becomes an editor, in any column', async () => {
      await makeBid('Alpha')
      await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
      renderGrid()
      await screen.findByText('Alpha')
      expect(lockSwitch()).toHaveAttribute('aria-pressed', 'false')
      expect(lockSwitch()).toHaveTextContent('Locked')
      expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
      expect(document.querySelector('[data-editable-cell]')).toBeNull()
      expect(screen.queryByTitle('Editable column')).not.toBeInTheDocument()
    })

    it('clicking a cell while locked does not edit — it opens the bid', async () => {
      const bid = await makeBid('Alpha')
      const { container } = renderGrid()
      await screen.findByText('Alpha')
      const row = screen.getByTestId('bid-row')
      await userEvent.click(within(row).getAllByRole('cell')[4])
      expect(container.querySelector('input[type=text]')).toBeNull()
      void bid
    })

    it('unlocking makes editable cells editable and marks them; read-only ones stay read-only', async () => {
      await makeBid('Alpha')
      await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      expect(lockSwitch()).toHaveAttribute('aria-pressed', 'true')
      expect(lockSwitch()).toHaveTextContent('Unlocked')
      for (const header of ['Opportunity / Mission', 'City', 'Sector', 'Note']) {
        expect(screen.getByRole('button', { name: `Edit ${header}` })).toBeInTheDocument()
      }
      expect(screen.getAllByTitle('Editable column').length).toBe(4)
      for (const header of ['Opportunity ID', 'Bid ID', 'Tender ID', 'Tender Link', 'Department / Client', 'State', 'Bid Owner', 'Bid Stage', 'Decision', 'Submission Deadline', 'Last Updated']) {
        expect(screen.queryByRole('button', { name: `Edit ${header}` })).not.toBeInTheDocument()
      }
    })

    it('read-only cells say why when the grid is unlocked', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      const cell = within(screen.getByTestId('bid-row')).getAllByRole('cell').find((c) => /Protected value/.test(c.getAttribute('title') ?? ''))
      expect(cell).toBeTruthy()
    })

    it('edits City, Sector and the name inline, and logs them against the bid', async () => {
      const bid = await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Sector' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Sector' }), 'Smart City{Enter}')
      await waitFor(async () => expect((await repository.getOpportunity(bid.opportunityId))?.vertical).toBe('Smart City'))
      // Clearing Sector stores an empty string (the API's Sector is not nullable).
      await userEvent.click(screen.getByRole('button', { name: 'Edit Sector' }))
      await userEvent.clear(screen.getByRole('textbox', { name: 'Sector' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Sector' }), '{Enter}')
      await waitFor(async () => expect((await repository.getOpportunity(bid.opportunityId))?.vertical).toBe(''))
      await userEvent.click(screen.getByRole('button', { name: 'Edit Opportunity / Mission' }))
      await userEvent.clear(screen.getByRole('textbox', { name: 'Opportunity / Mission' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity / Mission' }), 'Alpha Prime{Enter}')
      await waitFor(async () => expect((await repository.getOpportunity(bid.opportunityId))?.opportunityName).toBe('Alpha Prime'))
      const log = await repository.listAuditLogs({ entityType: 'bid', entityId: bid.id })
      expect(log.map((l) => l.field).sort()).toEqual(['opportunityName', 'vertical', 'vertical'])
    })

    it('the opportunity name cannot be saved empty', async () => {
      const bid = await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Opportunity / Mission' }))
      await userEvent.clear(screen.getByRole('textbox', { name: 'Opportunity / Mission' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity / Mission' }), '{Enter}')
      expect(await screen.findByRole('alert')).toHaveTextContent(/required/)
      expect((await repository.getOpportunity(bid.opportunityId))?.opportunityName).toBe('Alpha')
    })

    it('locking again exits editing, and a valid in-progress edit is saved, not lost', async () => {
      const { bid } = await bidWithColumn('text', 'Note')
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Note' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), 'half typed')
      await userEvent.click(lockSwitch()) // the click blurs the editor, which saves
      await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).note).toBe('half typed'))
      expect(lockSwitch()).toHaveTextContent('Locked')
      expect(screen.queryByRole('button', { name: 'Edit Note' })).not.toBeInTheDocument()
      expect(screen.getByText('half typed')).toBeInTheDocument()
    })

    it('an edit that cannot be saved blocks locking until it is kept or explicitly discarded', async () => {
      const { bid } = await bidWithColumn('email', 'Contact')
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Contact' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Contact' }), 'not-an-email')
      await userEvent.click(lockSwitch())
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('unsaved edit')
      expect(lockSwitch()).toHaveTextContent('Unlocked') // still unlocked behind the prompt

      await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByRole('textbox', { name: 'Contact' })).toHaveValue('not-an-email')
      expect(lockSwitch()).toHaveTextContent('Unlocked')

      await userEvent.click(lockSwitch())
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard edit and lock' }))
      await waitFor(() => expect(lockSwitch()).toHaveTextContent('Locked'))
      expect(screen.queryByRole('textbox', { name: 'Contact' })).not.toBeInTheDocument()
      expect((await repository.listBidCustomValues(bid.id)).contact).toBeUndefined()
    })

    it('Escape cancels an edit explicitly, after which locking needs no prompt', async () => {
      await bidWithColumn('text', 'Note')
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Note' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), 'draft{Escape}')
      await userEvent.click(lockSwitch())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(lockSwitch()).toHaveTextContent('Locked')
    })

    it('a save that fails after the grid was locked is reported in the toolbar', async () => {
      await bidWithColumn('text', 'Note')
      let reject: (e: Error) => void = () => {}
      vi.spyOn(repository, 'setBidCustomValue').mockImplementationOnce(() => new Promise((_, r) => { reject = r }))
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Note' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), 'oops{Enter}')
      await userEvent.click(lockSwitch())
      reject(new Error('Server said no'))
      expect(await screen.findByRole('alert')).toHaveTextContent('Note on BID-')
      expect(screen.getByRole('alert')).toHaveTextContent('Server said no')
    })
  })

  describe('freeze / unfreeze', () => {
    it('freezes nothing by default (only the selection checkbox column is pinned)', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      const sticky = Array.from(document.querySelectorAll('thead tr:nth-child(2) th')).filter((th) => th.className.includes('sticky'))
      expect(sticky).toHaveLength(0)
      expect(screen.queryByTitle('Frozen column')).not.toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeInTheDocument()
    })

    it('every data column has Freeze column in its header menu', async () => {
      await bidWithColumn('text', 'Note')
      renderGrid()
      await screen.findByText('Alpha')
      for (const header of ['Opportunity / Mission', 'Tender ID', 'Sector', 'Note']) {
        await userEvent.click(screen.getByRole('button', { name: `${header} column menu` }))
        expect(screen.getByRole('menuitem', { name: 'Freeze column' })).toBeEnabled()
        await userEvent.click(screen.getByRole('button', { name: `${header} column menu` })) // toggles it closed
        await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Freeze column' })).not.toBeInTheDocument())
      }
    })

    it('freezes and unfreezes a column; frozen columns lead the sheet and stack in order', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      const before = leafHeaders()
      expect(before.indexOf('Tender ID')).toBeGreaterThan(before.indexOf('Opportunity / Mission'))

      await userEvent.click(screen.getByRole('button', { name: 'Tender ID column menu' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Freeze column' }))
      expect(leafHeaders()[0]).toBe('Tender ID') // pinned to the left edge
      expect(leafTh('gemTenderId').className).toContain('sticky')
      expect(leafTh('gemTenderId').style.left).toBe('40px') // right after the 40px selection column

      await userEvent.click(screen.getByRole('button', { name: 'Opportunity / Mission column menu' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Freeze column' }))
      // Two frozen columns, in their normal relative order, each offset by the widths before it.
      expect(leafHeaders().slice(0, 2)).toEqual(['Opportunity / Mission', 'Tender ID'])
      const first = leafTh('opportunityName'); const second = leafTh('gemTenderId')
      expect(first.style.left).toBe('40px')
      expect(second.style.left).toBe('320px') // 40 + the 280px name column
      expect(first.className).toContain('sticky')
      expect(leafTh('bidCode').className).not.toContain('sticky')
      expect(screen.getAllByTitle('Frozen column')).toHaveLength(2)
      // The last frozen column carries the divider from the scrolling area.
      expect(second.className).toContain('border-r-2')
      expect(second.style.boxShadow).toContain('rgba')
      expect(first.className).not.toContain('border-r-2')

      await userEvent.click(screen.getByRole('button', { name: 'Tender ID column menu' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Unfreeze column' }))
      expect(leafTh('gemTenderId').className).not.toContain('sticky')
      // Back in its original place in the sheet.
      expect(leafHeaders().indexOf('Tender ID')).toBe(before.indexOf('Tender ID') - 0)
      expect(screen.getAllByTitle('Frozen column')).toHaveLength(1)
    })

    it('the frozen body cells stick too, and the choice is remembered', async () => {
      await makeBid('Alpha')
      const first = renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'City column menu' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Freeze column' }))
      const row = screen.getByTestId('bid-row')
      const stuck = Array.from(row.querySelectorAll('td')).filter((td) => td.className.includes('sticky'))
      expect(stuck).toHaveLength(2) // selection + City
      expect(JSON.parse(localStorage.getItem('goms:bidGrid:frozenColumns')!)).toEqual(['city'])
      first.unmount()
      renderGrid()
      await screen.findByText('Alpha')
      expect(leafHeaders()[0]).toBe('City')
    })

    it('the group header over a frozen column stays with it', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'City column menu' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Freeze column' }))
      const groups = Array.from(document.querySelectorAll('th[scope=colgroup]'))
      expect(groups[0].textContent).toBe('Client')
      expect(groups[0].className).toContain('sticky')
      expect((groups[0] as HTMLElement).style.left).toBe('40px')
    })

    it('freezing survives sorting, and freezing a hidden column set does not break the sheet', async () => {
      await makeBid('Alpha'); await makeBid('Beta')
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'Sector column menu' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Freeze column' }))
      await userEvent.click(screen.getByRole('button', { name: 'Sort by Opportunity / Mission' }))
      expect(rowNames()).toEqual(['Alpha', 'Beta'])
      expect(leafHeaders()[0]).toBe('Sector')
    })
  })

  describe('new column types', () => {
    it('currency: edits as an amount, shows ₹ with Indian grouping, sorts numerically', async () => {
      const { bid } = await bidWithColumn('currency', 'Budget')
      const other = await makeBid('Beta')
      const f = (await repository.listBidCustomFields())[0]
      await repository.setBidCustomValue(other.id, f.id, 900000)
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getAllByRole('button', { name: 'Edit Budget' })[0])
      await userEvent.type(screen.getByRole('spinbutton', { name: 'Budget' }), '750000{Enter}')
      await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).budget).toBe(750000))
      expect(await screen.findByText('₹7,50,000')).toBeInTheDocument()
      expect(screen.getByText('₹9,00,000')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Sort by Budget' }))
      expect(rowNames()).toEqual(['Alpha', 'Beta'])
      await userEvent.click(screen.getByRole('button', { name: 'Sort by Budget' }))
      expect(rowNames()).toEqual(['Beta', 'Alpha'])
    })

    it('url / email / phone: validated inline, rendered as links', async () => {
      const bid = await makeBid('Alpha')
      for (const [name, type] of [['Site', 'url'], ['Mail', 'email'], ['Phone', 'phone']] as const) {
        await repository.createBidCustomField({ name, dataType: type })
      }
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Mail' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Mail' }), 'bad{Enter}')
      expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/)
      await userEvent.clear(screen.getByRole('textbox', { name: 'Mail' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Mail' }), 'Ravi@Client.IN{Enter}')
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Site' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Site' }), 'gem.gov.in/b/1{Enter}')
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Phone' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Phone' }), '98765 43210{Enter}')
      await waitFor(async () => expect(await repository.listBidCustomValues(bid.id)).toEqual({
        mail: 'ravi@client.in', site: 'https://gem.gov.in/b/1', phone: '9876543210',
      }))
      // Unlocked, the text is plain so a click always starts the edit; locked, it is a link again.
      expect(screen.queryByRole('link', { name: 'ravi@client.in' })).not.toBeInTheDocument()
      await userEvent.click(lockSwitch())
      expect(await screen.findByRole('link', { name: 'ravi@client.in' })).toHaveAttribute('href', 'mailto:ravi@client.in')
      expect(screen.getByRole('link', { name: 'gem.gov.in/b/1' })).toHaveAttribute('href', 'https://gem.gov.in/b/1')
      expect(screen.getByRole('link', { name: '9876543210' })).toHaveAttribute('href', 'tel:9876543210')
    })

    it('person: picks a Sales Team member, stores the id, shows the name, sorts and searches by name', async () => {
      const { bid } = await bidWithColumn('person', 'Lead')
      const other = await makeBid('Beta')
      const asha = await repository.createSalesPerson({ name: 'Asha Rao', officialEmail: 'asha@amnex.com', designation: 'RM', tierKey: 'rm' })
      const zed = await repository.createSalesPerson({ name: 'Zed Khan', officialEmail: 'zed@amnex.com', designation: 'RM', tierKey: 'rm' })
      const f = (await repository.listBidCustomFields())[0]
      await repository.setBidCustomValue(other.id, f.id, zed.id)
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getAllByRole('button', { name: 'Edit Lead' })[0])
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Lead' }), 'Asha Rao')
      await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).lead).toBe(asha.id))
      expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Sort by Lead' }))
      expect(rowNames()).toEqual(['Alpha', 'Beta']) // Asha < Zed by name
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search bids' }), 'zed')
      expect(rowNames()).toEqual(['Beta'])
    })

    it('department and state: pick from the live records', async () => {
      const { bid } = await bidWithColumn('department', 'Nodal Dept')
      const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Health Dept' })
      const state = (await repository.listStates())[0]
      await repository.createBidCustomField({ name: 'Where', dataType: 'state' })
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Nodal Dept' }))
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nodal Dept' }), 'Health Dept')
      await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).nodal_dept).toBe(dept.id))
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Where' }))
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Where' }), state.name)
      await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).where).toBe(state.code))
      expect(await screen.findByText(state.name)).toBeInTheDocument()
    })

    it('multi-select: tick several options, Done saves, shown as chips', async () => {
      const { bid } = await bidWithColumn('multiselect', 'Regions', ['West', 'North', 'South'])
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Regions' }))
      const list = await screen.findByRole('listbox', { name: 'Regions options' })
      await userEvent.click(within(list).getByRole('checkbox', { name: 'South' }))
      await userEvent.click(within(list).getByRole('checkbox', { name: 'West' }))
      await userEvent.click(within(list).getByRole('button', { name: 'Done' }))
      await waitFor(async () => expect((await repository.listBidCustomValues(bid.id)).regions).toBe('["West","South"]'))
      expect(await screen.findByText('West')).toBeInTheDocument()
      expect(screen.getByText('South')).toBeInTheDocument()
    })

    it('multi-select: Cancel in the editor writes nothing', async () => {
      const { bid } = await bidWithColumn('multiselect', 'Regions', ['West', 'North'])
      renderGrid()
      await screen.findByText('Alpha')
      await unlock()
      await userEvent.click(screen.getByRole('button', { name: 'Edit Regions' }))
      const list = await screen.findByRole('listbox', { name: 'Regions options' })
      await userEvent.click(within(list).getByRole('checkbox', { name: 'West' }))
      await userEvent.click(within(list).getByRole('button', { name: 'Cancel' }))
      expect(await repository.listBidCustomValues(bid.id)).toEqual({})
    })

    it('Add column offers the new types, grouped, and creates a multi-select with options', async () => {
      await makeBid('Alpha')
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: /Add column/ }))
      const dialog = await screen.findByRole('dialog')
      const select = within(dialog).getByRole('combobox')
      const options = within(select).getAllByRole('option').map((o) => o.textContent)
      for (const label of ['Text', 'Number', 'Date', 'Yes / No', 'Select (dropdown)', 'Multi-select', 'Amount (₹)', 'URL', 'Email', 'Phone', 'Sales person', 'Department', 'State']) {
        expect(options).toContain(label)
      }
      await userEvent.type(within(dialog).getByRole('textbox', { name: /Column name/ }), 'Regions')
      await userEvent.selectOptions(select, 'Multi-select')
      const boxes = within(dialog).getAllByRole('textbox').filter((b) => !/Column name/.test(b.getAttribute('aria-label') ?? ''))
      await userEvent.type(boxes[boxes.length - 2], 'West')
      await userEvent.type(boxes[boxes.length - 1], 'North')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add column' }))
      await waitFor(async () => expect((await repository.listBidCustomFields()).find((f) => f.name === 'Regions')).toMatchObject({ dataType: 'multiselect', options: ['West', 'North'] }))
    })
  })

  describe('AND / OR filters', () => {
    async function seed() {
      await makeBid('Alpha'); await makeBid('Beta'); await makeBid('Gamma'); await makeBid('Delta')
    }
    const addFilter = async (scope: HTMLElement = document.body) => userEvent.click(within(scope).getAllByRole('button', { name: 'Add filter' })[0])
    const setRule = async (rule: HTMLElement, field: string, operator: string, value: string) => {
      await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Field' }), field)
      await userEvent.selectOptions(within(rule).getByRole('combobox', { name: 'Operator' }), operator)
      await userEvent.type(within(rule).getByRole('textbox', { name: 'Value' }), value)
    }

    it('"Match any" switches the top-level connective to OR', async () => {
      await seed()
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
      await addFilter(); await setRule(screen.getAllByTestId('filter-rule')[0], 'Opportunity / Mission', 'equals', 'Alpha')
      await addFilter(); await setRule(screen.getAllByTestId('filter-rule')[1], 'Opportunity / Mission', 'equals', 'Gamma')
      await waitFor(() => expect(rowNames()).toEqual([]))  // all of: nothing is both
      await userEvent.click(within(screen.getByRole('group', { name: 'Match conditions' })).getByRole('button', { name: 'Any' }))
      await waitFor(() => expect(rowNames().sort()).toEqual(['Alpha', 'Gamma']))
      expect(screen.getByTestId('active-filters')).toHaveTextContent(/Alpha.*or.*Gamma/)
    })

    it('builds Name = Delta AND (Name starts with A OR Name starts with B …) — a group inside an AND list', async () => {
      await seed()
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
      await addFilter()
      await setRule(screen.getAllByTestId('filter-rule')[0], 'Opportunity / Mission', 'contains', 'a') // Alpha Gamma Delta Beta(a)
      await userEvent.click(screen.getByRole('button', { name: 'Add group' }))
      const group = await screen.findByTestId('filter-group')
      const [r1, r2] = within(group).getAllByTestId('filter-rule')
      await setRule(r1, 'Opportunity / Mission', 'starts with', 'Al')
      await setRule(r2, 'Opportunity / Mission', 'starts with', 'Ga')
      await waitFor(() => expect(rowNames().sort()).toEqual(['Alpha', 'Gamma']))
      // The group reads as a bracketed OR in the active-filter bar.
      const bar = screen.getByTestId('active-filters')
      const bracket = within(bar).getByTestId('active-filter-group')
      expect(bracket).toHaveTextContent(/starts with Al.*or.*starts with Ga/)
      expect(bar).toHaveTextContent(/contains a.*and/)
    })

    it('flipping a group to "all" ANDs its conditions; Ungroup folds them back into the list', async () => {
      await seed()
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
      await addFilter()
      await userEvent.click(screen.getByRole('button', { name: 'Add group' }))
      const group = await screen.findByTestId('filter-group')
      const [r1, r2] = within(group).getAllByTestId('filter-rule')
      await setRule(r1, 'Opportunity / Mission', 'contains', 'a')
      await setRule(r2, 'Opportunity / Mission', 'contains', 'p')
      const rootRule = screen.getAllByTestId('filter-rule')[0]
      await setRule(rootRule, 'Opportunity / Mission', 'contains', 'l')
      // Default for a group in an "all" list is "any": a-or-p, and l.
      await waitFor(() => expect(rowNames().sort()).toEqual(['Alpha', 'Delta']))
      await userEvent.click(within(within(group).getByRole('group', { name: 'Group: match conditions' })).getByRole('button', { name: 'All' }))
      await waitFor(() => expect(rowNames()).toEqual(['Alpha'])) // l, a and p
      await userEvent.click(within(group).getByRole('button', { name: 'Ungroup' }))
      expect(screen.queryByTestId('filter-group')).not.toBeInTheDocument()
      expect(screen.getAllByTestId('filter-rule')).toHaveLength(3)
      await waitFor(() => expect(rowNames()).toEqual(['Alpha']))
    })

    it('removing a group\'s rules removes the group; a chip × removes just that condition', async () => {
      await seed()
      renderGrid({ filterRules: [
        { field: 'opportunityName', operator: 'contains', value: 'a' },
        { logic: 'or', rules: [
          { field: 'opportunityName', operator: 'startsWith', value: 'Al' },
          { field: 'opportunityName', operator: 'startsWith', value: 'Ga' },
        ] },
      ] })
      await screen.findByText('Alpha')
      await waitFor(() => expect(rowNames().sort()).toEqual(['Alpha', 'Gamma']))
      await userEvent.click(screen.getByRole('button', { name: 'Clear filter Opportunity / Mission starts with Ga' }))
      await waitFor(() => expect(rowNames()).toEqual(['Alpha']))
      await userEvent.click(screen.getByRole('button', { name: 'Clear filter Opportunity / Mission starts with Al' }))
      await waitFor(() => expect(rowNames().sort()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']))
      expect(screen.queryByTestId('active-filter-group')).not.toBeInTheDocument()
    })

    it('custom columns and entity columns filter inside a group', async () => {
      const [a, b] = [await makeBid('Alpha'), await makeBid('Beta')]; await makeBid('Gamma')
      const tier = await repository.createBidCustomField({ name: 'Tier', dataType: 'select', options: ['Gold', 'Silver'] })
      const lead = await repository.createBidCustomField({ name: 'Lead', dataType: 'person' })
      const asha = await repository.createSalesPerson({ name: 'Asha Rao', officialEmail: 'asha@amnex.com', designation: 'RM', tierKey: 'rm' })
      await repository.setBidCustomValue(a.id, tier.id, 'Gold')
      await repository.setBidCustomValue(b.id, lead.id, asha.id)
      renderGrid({ filterRules: [{ logic: 'or', rules: [
        { field: 'custom:tier', operator: 'eq', value: 'Gold' },
        { field: 'custom:lead', operator: 'eq', value: asha.id },
      ] }] })
      await screen.findByText('Alpha')
      await waitFor(() => expect(rowNames().sort()).toEqual(['Alpha', 'Beta']))
      // The chip reads the person's NAME, not the id.
      expect(screen.getByTestId('active-filters')).toHaveTextContent('Lead is Asha Rao')
    })

    it('the State column filters by state name (a pick-list, not a code)', async () => {
      await seed()
      renderGrid()
      await screen.findByText('Alpha')
      await userEvent.click(screen.getByRole('button', { name: 'State column menu' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Filter by this column' }))
      const rule = await screen.findByTestId('filter-rule')
      expect(within(rule).getByRole('combobox', { name: 'Field' })).toHaveValue('stateCode')
      const state = (await repository.listStates())[0]
      expect(within(within(rule).getByRole('combobox', { name: 'Value' })).getByRole('option', { name: state.name })).toBeInTheDocument()
    })
  })
})

void fireEvent

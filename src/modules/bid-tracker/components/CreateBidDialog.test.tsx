import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { CreateBidDialog } from './CreateBidDialog'

function renderDialog(onClose = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/bid-tracker']}>
        <Routes>
          <Route path="/bid-tracker" element={<CreateBidDialog open onClose={onClose} />} />
          <Route path="/bid-tracker/bid/:bidId" element={<div>Bid detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const dept = (name: string, parentId: string | null = null) =>
  repository.createNode({ domain: 'org', typeKey: 'department', parentId, stateCode: 0, name })
/** MeitY → India AI, the department an opportunity can belong to. */
async function meityIndiaAi() {
  const meity = await dept('MeitY')
  return { meity, indiaAi: await dept('India AI', meity.id) }
}
const opp = (name: string, departmentId: string | null, extra: { gemTenderId?: string; city?: string } = {}) =>
  repository.createOpportunity({ departmentId: departmentId ?? 'tmp', opportunityName: name, submissionDate: '2099-01-15', ...extra })
    .then(async (o) => (departmentId === null ? repository.updateOpportunity(o.id, { departmentId: null }) : o))
const orgNames = async () => (await repository.listDepartments()).map((d) => d.name).sort()
const pick = async (name: string | RegExp) => userEvent.click(await screen.findByRole('button', { name }))
const choose = async (comboName: string, optionLabel: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: comboName }))
  await userEvent.click(await screen.findByText(optionLabel))
}
const createButton = () => screen.getByRole('button', { name: 'Create bid' })
const createButtonNew = () => screen.getByRole('button', { name: 'Create opportunity and bid' })

describe('CreateBidDialog', () => {
  beforeEach(async () => { await resetLocalData() })

  it('lists only opportunities without a bid, with their department path, and narrows by search', async () => {
    const { indiaAi } = await meityIndiaAi()
    const withBid = await opp('Has a bid', indiaAi.id)
    await repository.createBid(withBid.id)
    await opp('Road Sensors', indiaAi.id, { gemTenderId: 'GEM/ROAD/1' })
    await opp('Water Meters', indiaAi.id, { city: 'Surat' })
    await opp('Orphan', null)
    renderDialog()
    const list = await screen.findByTestId('bid-opportunity-list')
    await waitFor(() => expect(within(list).getByText('Road Sensors')).toBeInTheDocument())
    expect(within(list).queryByText('Has a bid')).not.toBeInTheDocument()
    expect(within(list).getAllByText(/MeitY → India AI/, { selector: 'span' }).length).toBeGreaterThan(0)
    expect(within(list).getByText(/No department yet/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search opportunities' }), 'surat')
    expect(within(list).queryByText('Road Sensors')).not.toBeInTheDocument()
    expect(within(list).getByText('Water Meters')).toBeInTheDocument()
  })

  it('opportunity WITH a department: shows Department and Major Department, never asks again, and creates the bid', async () => {
    const { indiaAi } = await meityIndiaAi()
    const target = await opp('AI Solution', indiaAi.id)
    renderDialog()
    await pick(/AI Solution/)
    const resolved = await screen.findByTestId('department-resolved')
    expect(resolved).toHaveTextContent('Department India AI')
    expect(resolved).toHaveTextContent('Major Department MeitY')
    expect(screen.queryByTestId('department-required')).not.toBeInTheDocument()
    await userEvent.click(createButton())
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    expect((await repository.getBidForOpportunity(target.id))?.opportunityId).toBe(target.id)
    expect((await repository.listOpportunities()).find((o) => o.id === target.id)?.departmentId).toBe(indiaAi.id)
  })

  it('opportunity WITHOUT a department: the department step is required, and offered instead of a dead end', async () => {
    await opp('AI Solution', null)
    renderDialog()
    await pick(/AI Solution/)
    expect(await screen.findByTestId('department-required')).toBeInTheDocument()
    expect(createButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Select existing department' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create new department' })).toBeInTheDocument()
  })

  it('no department → select an existing one: the opportunity is assigned, then the bid is created', async () => {
    const { indiaAi } = await meityIndiaAi()
    const target = await opp('AI Solution', null)
    renderDialog()
    await pick(/AI Solution/)
    await choose('Existing department', 'MeitY → India AI')
    expect(screen.getByTestId('department-preview')).toHaveTextContent('MeitY → India AI')
    await userEvent.click(createButton())
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    expect((await repository.listOpportunities()).find((o) => o.id === target.id)?.departmentId).toBe(indiaAi.id)
    expect(await repository.getBidForOpportunity(target.id)).not.toBeNull()
  })

  it('a duplicate bid is still rejected: server message shown, dialog stays, nothing navigates', async () => {
    const { indiaAi } = await meityIndiaAi()
    const raced = await opp('Raced', indiaAi.id)
    renderDialog()
    await pick(/Raced/)
    await repository.createBid(raced.id) // someone else got there first
    await userEvent.click(createButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('already has a bid')
    expect(screen.queryByText('Bid detail page')).not.toBeInTheDocument()
  })

  it('says so when every opportunity already has a bid', async () => {
    const { indiaAi } = await meityIndiaAi()
    const only = await opp('Only one', indiaAi.id)
    await repository.createBid(only.id)
    renderDialog()
    expect(await screen.findByTestId('bid-opportunity-empty')).toHaveTextContent('already has a bid')
  })

  // ---- creating the opportunity inside the dialog ---------------------------------------------
  const startNew = async () => userEvent.click(await screen.findByRole('button', { name: /Create new opportunity/ }))
  const oppNames = async () => (await repository.listOpportunities()).map((o) => o.opportunityName)

  it('new opportunity + existing department: creates the opportunity and its bid, then opens the bid', async () => {
    const { indiaAi } = await meityIndiaAi()
    renderDialog()
    await startNew()
    expect(createButtonNew()).toBeDisabled() // name and department both required
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'AI Solution')
    expect(createButtonNew()).toBeDisabled() // still no department
    await choose('Existing department', 'MeitY → India AI')
    expect(screen.getByTestId('department-preview')).toHaveTextContent('MeitY → India AI')
    await userEvent.click(createButtonNew())
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    const created = (await repository.listOpportunities()).find((o) => o.opportunityName === 'AI Solution')!
    expect(created.departmentId).toBe(indiaAi.id)
    expect(await repository.getBidForOpportunity(created.id)).not.toBeNull()
  })

  it('finds an existing department by its short name', async () => {
    const { indiaAi } = await meityIndiaAi()
    await repository.updateNode(indiaAi.id, { metadata: { shortName: 'IAA' } })
    renderDialog()
    await startNew()

    const departmentSearch = screen.getByRole('combobox', { name: 'Existing department' })
    await userEvent.type(departmentSearch, 'IAA')
    const option = await screen.findByRole('option', { name: 'MeitY → India AI' })
    await userEvent.click(option)

    expect(screen.getByTestId('department-preview')).toHaveTextContent('MeitY → India AI')
  })

  it('new opportunity: tender ID, reference / bid no, deadline and name of assignment are saved; there is no city field', async () => {
    const { indiaAi } = await meityIndiaAi()
    renderDialog()
    await startNew()
    expect(screen.queryByRole('textbox', { name: 'City' })).not.toBeInTheDocument()
    expect(screen.getByText('Bid submission deadline')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tender ID' }), 'GEM/2026/B/1')
    await userEvent.type(screen.getByRole('textbox', { name: 'Reference / Bid No' }), 'REF-42')
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'AI Solution')
    await userEvent.type(screen.getByRole('textbox', { name: 'Name of assignment' }), 'Supply of AI compute')
    await choose('Existing department', 'MeitY → India AI')
    await userEvent.click(createButtonNew())
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    const created = (await repository.listOpportunities()).find((o) => o.opportunityName === 'AI Solution')!
    expect(created).toMatchObject({
      departmentId: indiaAi.id, gemTenderId: 'GEM/2026/B/1', referenceNo: 'REF-42', assignmentName: 'Supply of AI compute',
    })
  })

  it('new opportunity: a pasted date and time is saved with its time component', async () => {
    await meityIndiaAi()
    renderDialog()
    await startNew()
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'Timed deadline')
    await userEvent.type(screen.getByRole('textbox', { name: 'Submission date and time' }), '24thsept261500')
    await choose('Existing department', 'MeitY → India AI')
    await userEvent.click(createButtonNew())
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    const created = (await repository.listOpportunities()).find((o) => o.opportunityName === 'Timed deadline')!
    expect(Date.parse(created.submissionDate)).toBe(new Date(2026, 8, 24, 15).getTime())
  })

  it('opens the Account Mapping department form without losing the Create Bid draft', async () => {
    renderDialog()
    await startNew()
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'Draft opportunity')
    await userEvent.type(screen.getByRole('textbox', { name: 'Submission date and time' }), '24thsept261500')

    await userEvent.click(screen.getByRole('button', { name: 'Create new department' }))
    const departmentDialog = await screen.findByRole('dialog', { name: 'New department' })
    expect(screen.getByRole('dialog', { name: 'Create Bid' })).toBeInTheDocument()
    await userEvent.click(within(departmentDialog).getByRole('button', { name: 'Cancel' }))
    // The dialog unmounts after its exit fade.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New department' })).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Opportunity name' })).toHaveValue('Draft opportunity')
    expect(screen.getByRole('textbox', { name: 'Submission date and time' })).toHaveValue('24thsept261500')
    expect(await orgNames()).not.toContain('Draft Department')

    await userEvent.click(screen.getByRole('button', { name: 'Create new department' }))
    const createDialog = await screen.findByRole('dialog', { name: 'New department' })
    await userEvent.type(within(createDialog).getByRole('textbox', { name: 'Full name' }), 'Draft Department')
    await userEvent.click(within(createDialog).getByRole('button', { name: 'Create department' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New department' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('department-preview')).toHaveTextContent('Draft Department'))
    expect(screen.getByRole('textbox', { name: 'Opportunity name' })).toHaveValue('Draft opportunity')
    expect(screen.getByRole('textbox', { name: 'Submission date and time' })).toHaveValue('24thsept261500')
    expect((await repository.listDepartments()).some((d) => d.name === 'Draft Department')).toBe(true)
  })

  it('live-parses pasted date strings and keeps the raw value editable until create', async () => {
    const { indiaAi } = await meityIndiaAi()
    renderDialog()
    await startNew()
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'Date parsing')
    await choose('Existing department', 'MeitY → India AI')
    const input = screen.getByRole('textbox', { name: 'Submission date and time' })
    await userEvent.type(input, '13th may 2026 1500')
    expect(screen.getByText(/Captured:/i)).toHaveTextContent('13 May 2026, 15:00')
    await userEvent.clear(input)
    await userEvent.type(input, '13/5/26 3pm')
    expect(screen.getByText(/Captured:/i)).toHaveTextContent('13 May 2026, 15:00')
    await userEvent.clear(input)
    await userEvent.type(input, 'Feb 30 2026')
    expect(screen.queryByText(/Captured:/i)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid date and time')
    expect(createButtonNew()).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, '24thsept261500')
    expect(screen.getByText(/Captured:/i)).toHaveTextContent('24 September 2026, 15:00')
    expect(input).toHaveValue('24thsept261500')
    expect(createButtonNew()).toBeEnabled()
    expect(indiaAi.name).toBe('India AI')
  })

  it('new opportunity: previews the Opportunity ID live, saves the type, and assigns the number on save', async () => {
    await meityIndiaAi()
    renderDialog()
    await startNew()
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'Coded')
    const preview = screen.getByTestId('opportunity-code-preview')
    await userEvent.type(screen.getByRole('textbox', { name: 'Submission date and time' }), '24/09/2026 15:00')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Opportunity type' }), 'RFP')
    expect(preview).toHaveTextContent('FY27-Q2-NA-NA-NA-NA-RFP-NA-#')
    await choose('Existing department', 'MeitY → India AI')
    await waitFor(() => expect(preview).toHaveTextContent('FY27-Q2-NA-CENTRAL-CEN-IA-RFP-NA-#'))
    await userEvent.click(createButtonNew())
    await screen.findByText('Bid detail page')
    const created = (await repository.listOpportunities()).find((o) => o.opportunityName === 'Coded')!
    expect(created.opportunityType).toBe('RFP')
    expect(created.opportunityCode).toBe('FY27-Q2-NA-CENTRAL-CEN-IA-RFP-NA-1')
  })

  it('when every opportunity already has a bid, the empty state still leads somewhere: create a new opportunity', async () => {
    const { indiaAi } = await meityIndiaAi()
    const only = await opp('Only one', indiaAi.id)
    await repository.createBid(only.id)
    renderDialog()
    expect(await screen.findByTestId('bid-opportunity-empty')).toHaveTextContent('create a new opportunity')
    await startNew()
    expect(await screen.findByTestId('new-opportunity-form')).toBeInTheDocument()
  })

})

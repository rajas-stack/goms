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
    expect(screen.getByRole('button', { name: 'Create new department hierarchy' })).toBeInTheDocument()
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

  it('no department → create India AI under the existing MeitY: department created, assigned, bid created', async () => {
    const meity = await dept('MeitY')
    const target = await opp('AI Solution', null)
    renderDialog()
    await pick(/AI Solution/)
    await userEvent.click(screen.getByRole('button', { name: 'Create new department hierarchy' }))
    await choose('Major department', 'MeitY')
    await userEvent.type(screen.getByRole('textbox', { name: 'New department name' }), 'India AI')
    expect(screen.getByTestId('department-preview')).toHaveTextContent('MeitY → India AI (new)')
    await userEvent.click(createButton())
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    const indiaAi = (await repository.listDepartments()).find((d) => d.name === 'India AI')!
    expect(indiaAi).toMatchObject({ parentId: meity.id, typeKey: 'department' })
    expect((await repository.listOpportunities()).find((o) => o.id === target.id)?.departmentId).toBe(indiaAi.id)
    expect(await repository.getBidForOpportunity(target.id)).not.toBeNull()
  })

  it('no department → create BOTH a new major department (MeitY) and India AI', async () => {
    const target = await opp('AI Solution', null)
    renderDialog()
    await pick(/AI Solution/)
    await userEvent.click(screen.getByRole('button', { name: 'Create new department hierarchy' }))
    await userEvent.click(screen.getByRole('button', { name: 'New' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New major department name' }), 'MeitY')
    await userEvent.type(screen.getByRole('textbox', { name: 'New department name' }), 'India AI')
    expect(screen.getByTestId('department-preview')).toHaveTextContent('MeitY (new) → India AI (new)')
    await userEvent.click(createButton())
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    const all = await repository.listDepartments()
    const meity = all.find((d) => d.name === 'MeitY')!
    const indiaAi = all.find((d) => d.name === 'India AI')!
    expect(meity.parentId).toBeNull()
    expect(indiaAi.parentId).toBe(meity.id)
    expect((await repository.listOpportunities()).find((o) => o.id === target.id)?.departmentId).toBe(indiaAi.id)
  })

  it('cancelling the dialog makes no changes', async () => {
    const meity = await dept('MeitY')
    const target = await opp('AI Solution', null)
    const namesBefore = await orgNames()
    let closed = false
    renderDialog(() => { closed = true })
    await pick(/AI Solution/)
    await userEvent.click(screen.getByRole('button', { name: 'Create new department hierarchy' }))
    await choose('Major department', 'MeitY')
    await userEvent.type(screen.getByRole('textbox', { name: 'New department name' }), 'India AI')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(closed).toBe(true)
    expect(await orgNames()).toEqual(namesBefore)
    expect((await repository.listOpportunities()).find((o) => o.id === target.id)?.departmentId).toBeNull()
    expect(await repository.getBidForOpportunity(target.id)).toBeNull()
    expect(meity.name).toBe('MeitY')
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

  it('a failed hierarchy step creates no partial bid: the department vanished mid-flow, so no bid, no assignment, no new nodes', async () => {
    const { meity } = await meityIndiaAi()
    const target = await opp('AI Solution', null)
    renderDialog()
    await pick(/AI Solution/)
    await userEvent.click(screen.getByRole('button', { name: 'Create new department hierarchy' }))
    await choose('Major department', 'MeitY')
    await userEvent.type(screen.getByRole('textbox', { name: 'New department name' }), 'Brand New Dept')
    const namesBefore = await orgNames()
    await repository.deleteNode(meity.id) // gone before the user presses Create
    await userEvent.click(createButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/)
    expect(await repository.getBidForOpportunity(target.id)).toBeNull()
    expect((await repository.listOpportunities()).find((o) => o.id === target.id)?.departmentId).toBeNull()
    expect((await orgNames()).filter((n) => n === 'Brand New Dept')).toHaveLength(0)
    expect((await orgNames()).length).toBeLessThanOrEqual(namesBefore.length)
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

  it('new opportunity + a newly created hierarchy (MeitY → India AI): all three are created', async () => {
    renderDialog()
    await startNew()
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'AI Solution')
    await userEvent.click(screen.getByRole('button', { name: 'Create new department hierarchy' }))
    await userEvent.click(screen.getByRole('button', { name: 'New' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New major department name' }), 'Brand New Ministry')
    await userEvent.type(screen.getByRole('textbox', { name: 'New department name' }), 'Brand New Dept')
    expect(screen.getByTestId('department-preview')).toHaveTextContent('Brand New Ministry (new) → Brand New Dept (new)')
    await userEvent.click(createButtonNew())
    expect(await screen.findByText('Bid detail page')).toBeInTheDocument()
    const all = await repository.listDepartments()
    const major = all.find((d) => d.name === 'Brand New Ministry')!
    const child = all.find((d) => d.name === 'Brand New Dept')!
    expect(child.parentId).toBe(major.id)
    const created = (await repository.listOpportunities()).find((o) => o.opportunityName === 'AI Solution')!
    expect(created.departmentId).toBe(child.id)
    expect(await repository.getBidForOpportunity(created.id)).not.toBeNull()
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

  it('cancelling after filling in a new opportunity and hierarchy creates nothing', async () => {
    await meityIndiaAi()
    const oppsBefore = await oppNames(), namesBefore = await orgNames()
    renderDialog()
    await startNew()
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'Abandoned')
    await userEvent.click(screen.getByRole('button', { name: 'Create new department hierarchy' }))
    await userEvent.click(screen.getByRole('button', { name: 'New' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New major department name' }), 'Abandoned Ministry')
    await userEvent.type(screen.getByRole('textbox', { name: 'New department name' }), 'Abandoned Dept')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await oppNames()).toEqual(oppsBefore)
    expect(await orgNames()).toEqual(namesBefore)
  })

  it('a failed department step creates no opportunity, no hierarchy and no bid', async () => {
    const { meity } = await meityIndiaAi()
    const oppsBefore = await oppNames()
    renderDialog()
    await startNew()
    await userEvent.type(screen.getByRole('textbox', { name: 'Opportunity name' }), 'Will not exist')
    await userEvent.click(screen.getByRole('button', { name: 'Create new department hierarchy' }))
    await choose('Major department', 'MeitY')
    await userEvent.type(screen.getByRole('textbox', { name: 'New department name' }), 'Orphan Dept')
    await repository.deleteNode(meity.id) // the parent disappears before the user presses Create
    await userEvent.click(createButtonNew())
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/)
    expect(await oppNames()).toEqual(oppsBefore)
    expect((await orgNames()).filter((n) => n === 'Orphan Dept')).toHaveLength(0)
    expect(screen.queryByText('Bid detail page')).not.toBeInTheDocument()
  })
})

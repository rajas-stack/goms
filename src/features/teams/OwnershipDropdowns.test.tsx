import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { MasterGrid } from '@/modules/bid-tracker/components/MasterGrid'
import { GeneralTab } from '@/modules/bid-tracker/synopsis/GeneralTab'
import type { SheetId } from '@/modules/bid-tracker/sheets'
import { OpportunityTeamAssignments } from './OpportunityTeamAssignments'

const fields = [
  { label: 'Legal', key: 'legalPersonId', name: 'Legal Owner' },
  { label: 'Pre-sales', key: 'preSalesPersonId', name: 'Presales Owner' },
  { label: 'Bid', key: 'bidTeamMemberId', name: 'Bid Owner' },
] as const

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
}

async function seed(sheet: SheetId = 'bidTracker') {
  await repository.createOrgPerson({ name: 'Legal Owner', level: 3, departments: ['Legal'] })
  await repository.createOrgPerson({ name: 'Presales Owner', level: 3, departments: ['Pre-Sales'] })
  await repository.createOrgPerson({ name: 'Bid Owner', level: 3, departments: ['Bid Management'] })
  const moved = await repository.createOrgPerson({ name: 'Moved Employee', level: 3, departments: ['Finance'], email: 'moved@amnex.com' })
  const roster = await repository.listDeliveryTeamMembers()
  vi.spyOn(repository, 'listDeliveryTeamMembers').mockResolvedValue([
    ...roster, { id: 'stale-legal', team: 'legal', name: moved.name, email: moved.email, designation: '', status: 'active', managerId: null, createdAt: moved.createdAt },
  ])
  const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Ownership check' })
  const bid = await repository.createBid(opportunity.id, undefined, sheet === 'master' ? 'bidTracker' : sheet)
  return { bid, opportunity, roster }
}

async function checkPicker(label: string, expectedName: string) {
  const list = await screen.findByRole('listbox', { name: label })
  expect(await within(list).findByRole('option', { name: expectedName })).toBeInTheDocument()
  for (const field of fields.filter(field => field.name !== expectedName)) {
    expect(within(list).queryByRole('option', { name: field.name })).not.toBeInTheDocument()
  }
  await waitFor(() => expect(within(list).queryByRole('option', { name: 'Moved Employee' })).not.toBeInTheDocument())
  return list
}

describe('department-specific opportunity pickers', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    localStorage.clear()
    await resetLocalData()
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) })
  })

  it.each<SheetId>(['bidTracker', 'pipeline-funnel', 'pipeline-backup', 'pipeline-commits', 'campaign', 'master'])('filters ownership dropdowns and saves roster ids in %s', async sheet => {
    const { opportunity, roster } = await seed(sheet)
    render(<MasterGrid sheet={sheet} visibleColumns={['opportunityName', ...fields.map(field => field.key)]} />, { wrapper })
    await screen.findByText('Ownership check')
    await userEvent.click(screen.getByRole('button', { name: /editing locked/ }))
    for (const field of fields) {
      await userEvent.click(screen.getByRole('button', { name: `Edit ${field.label}` }))
      const list = await checkPicker(field.label, field.name)
      await userEvent.click(within(list).getByRole('option', { name: field.name }))
      await waitFor(async () => expect((await repository.listOpportunities()).find(row => row.id === opportunity.id)?.[field.key]).toBe(roster.find(member => member.name === field.name)!.id))
    }
  })

  it('uses the same department lists in General details', async () => {
    const { bid } = await seed()
    render(<GeneralTab bidId={bid.id} />, { wrapper })
    await screen.findByTestId('bid-general-form')
    for (const field of fields) {
      await userEvent.click(screen.getByRole('button', { name: `Edit ${field.label}` }))
      await checkPicker(field.label, field.name)
      await userEvent.keyboard('{Escape}')
    }
  })

  it('uses department lists when creating or editing the opportunity team', async () => {
    const { roster } = await seed()
    const onChange = vi.fn()
    render(<OpportunityTeamAssignments value={{}} onChange={onChange} />, { wrapper })
    for (const field of fields) {
      await userEvent.click(screen.getByRole('combobox', { name: field.label }))
      const list = await screen.findByRole('listbox')
      const option = await within(list).findByRole('option', { name: field.name })
      for (const other of fields.filter(other => other.key !== field.key)) {
        expect(within(list).queryByRole('option', { name: other.name })).not.toBeInTheDocument()
      }
      await waitFor(() => expect(within(list).queryByRole('option', { name: 'Moved Employee' })).not.toBeInTheDocument())
      await userEvent.click(option)
      expect(onChange).toHaveBeenLastCalledWith(field.key, roster.find(member => member.name === field.name)!.id)
    }
  })
})

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'

const data = vi.hoisted(() => ({
  am: [{
    id: 'e1', code: 'C1', name: 'Dev Officer', designation: 'Secretary', email: 'dev@gov.in', phone: '1', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: 'n1', managerId: null, vacant: false, connected: false, relationshipStatus: 'new', relationshipQuality: 'neutral',
    relationshipType: '', introducedBy: '', importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: {}, status: 'active',
  }],
  org: [
    { id: 'p1', name: 'Asha Lead', designation: 'Head', level: 2, departments: ['Pre-Sales'], managerId: null, email: 'asha@amnex.com', status: 'active', createdAt: '2026-01-01' },
    { id: 'p2', name: 'Bina Analyst', designation: 'Analyst', level: 4, departments: ['Legal'], managerId: 'p1', email: '', status: 'active', createdAt: '2026-01-01' },
  ],
  contacts: [{ id: 'c1', email: 'olu@oem.com', name: 'Olu Vendor', party: 'oem', organization: 'OEM Ltd', departmentId: null }],
  members: [{ id: 'm1', team: 'preSales', name: 'Asha Lead', email: 'asha@amnex.com', designation: 'Head', status: 'active', managerId: null, orgPersonId: 'p1', createdAt: '2026-01-01' }],
  opportunities: [{ id: 'o1', opportunityName: 'Smart City', preSalesPersonId: 'm1', stageKey: 'open-stage', vertical: '' }],
  createContact: vi.fn(async (input: Record<string, unknown>) => ({ id: 'c9', ...input })),
}))

vi.mock('@/data/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/repository')>()),
  repository: {
    listAllEmployees: vi.fn(async () => data.am), listEmployeeDepartments: vi.fn(async () => ({ e1: { id: 'n1', name: 'Dept of IT' } })),
    listOrgPeople: vi.fn(async () => data.org), listDeliveryTeamMembers: vi.fn(async () => data.members), listSalesPersons: vi.fn(async () => []),
    listAmnexDepartments: vi.fn(async () => ['Sales', 'Pre-Sales', 'Legal', 'HR', 'Delivery'].map((name, i) => ({ id: `d${i}`, name, systemKey: name === 'Pre-Sales' ? 'presales' : null, sortOrder: i }))),
    listOpportunities: vi.fn(async () => data.opportunities), listCompetitors: vi.fn(async () => [{ id: 'k1', name: 'Rival Co' }]),
    createCompetitor: vi.fn(async ({ name }: { name: string }) => ({ id: 'k2', name })), listMaster: vi.fn(async () => []),
    createOrgPerson: vi.fn(async (input: Record<string, unknown>) => ({ id: 'p9', ...input })), updateOrgPerson: vi.fn(async () => ({})), deleteOrgPerson: vi.fn(async () => undefined), getMyAccess: vi.fn(),
  },
}))
vi.mock('@/features/communication/api', () => ({
  useCommunicationContacts: () => ({ data: data.contacts, isLoading: false }),
  useContactMutations: () => ({ create: { mutateAsync: data.createContact, isPending: false }, update: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn() } }),
}))
vi.mock('@/features/masters/useMasterOptions', () => ({
  useDirectoryTypes: () => [{ code: 'internal', name: 'Amnex Employee' }, { code: 'department', name: 'Departmental' }, { code: 'oem', name: 'OEMs' }, { code: 'competitor', name: 'Competitors' }, { code: 'consortium', name: 'Consortium Partners' }],
  useClientDepartmentOptions: () => ({ data: [] }),
}))
vi.mock('@/features/dms/profileImagesClient', () => ({ useProfileImages: () => ({ data: undefined, isError: false }) }))
vi.mock('@/lib/useMediaQuery', () => ({ useMediaQuery: (q: string) => q.includes('min-width') }))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 50, measureElement: () => {}, scrollToIndex: () => {},
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 50, size: 50 })),
  }),
}))

import { repository } from '@/data/repository'
import { Directory } from './Directory'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
function renderDirectory(access: unknown = { mode: 'off', email: null, roles: [], facts: null }, url = '/teams/directory') {
  const router = createMemoryRouter([{ path: '/teams/directory', element: <Directory /> }], { initialEntries: [url] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PermissionsProvider access={access as never}><RouterProvider router={router} /></PermissionsProvider>
    </QueryClientProvider>,
  )
  return router
}
const rows = () => screen.queryAllByTestId(/^person-row-/).map((r) => r.textContent)

beforeEach(() => { vi.mocked(repository.deleteOrgPerson).mockClear(); vi.mocked(repository.updateOrgPerson).mockClear() })

describe('Directory — every person in one list', () => {
  it('lists Amnex employees, Account Mapping people and address-book contacts, filtered by type then category', async () => {
    const user = userEvent.setup()
    const router = renderDirectory()
    await screen.findByText('Asha Lead')
    expect(screen.getByText('Dev Officer')).toBeInTheDocument()
    expect(screen.getByText('Olu Vendor')).toBeInTheDocument()

    const category = screen.getByLabelText('Category')
    expect(category).toBeDisabled() // depends on the contact type
    await user.selectOptions(screen.getByLabelText('Contact type'), 'external')
    expect(rows().join()).not.toMatch(/Asha|Bina/)
    await user.selectOptions(screen.getByLabelText('Category'), 'oem')
    expect(rows()).toHaveLength(1)
    expect(router.state.location.search).toContain('cat=oem')

    // Switching type resets the category that does not belong to it.
    await user.selectOptions(screen.getByLabelText('Contact type'), 'internal')
    expect(router.state.location.search).not.toContain('cat=')
    const departments = within(screen.getByLabelText('Department')).getAllByRole('option').map((o) => o.textContent)
    expect(departments).toEqual(expect.arrayContaining(['Sales', 'Pre-Sales', 'Legal', 'HR', 'Delivery']))
    await user.selectOptions(screen.getByLabelText('Department'), 'Legal')
    expect(rows()).toEqual([expect.stringContaining('Bina Analyst')])
  })

  it('opens an old /teams?type=<Directory Types code> link on that category', async () => {
    renderDirectory(undefined, '/teams/directory?type=oem')
    await screen.findByText('Olu Vendor')
    expect(rows()).toHaveLength(1)
  })

  it('names linked records before deleting an Amnex employee', async () => {
    const user = userEvent.setup()
    renderDirectory()
    await user.click(await screen.findByRole('button', { name: 'Delete Asha Lead' }))
    expect(screen.getByText('1 direct report moves up to the top of the company.')).toBeInTheDocument()
    expect(screen.getByText(/Pre-Sales roster entries turn inactive; opportunity assignments are kept/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(repository.deleteOrgPerson).toHaveBeenCalledWith('p1')
  })

  it('keeps an unsaved edit when the profile is expanded to full screen and back', async () => {
    const user = userEvent.setup()
    renderDirectory()
    await user.click(await screen.findByRole('button', { name: 'Edit Bina Analyst' }))
    const name = await screen.findByLabelText('Full name')
    await user.clear(name)
    await user.type(name, 'Bina Rao')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand details to full screen' }))
    expect(screen.getByLabelText('Full name')).toHaveValue('Bina Rao')
    await user.click(screen.getByRole('button', { name: 'Collapse details' }))
    expect(screen.getByLabelText('Full name')).toHaveValue('Bina Rao')

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(repository.updateOrgPerson).toHaveBeenCalledWith('p2', { name: 'Bina Rao' })
  })

  it('asks before an unsaved edit is lost to another selection', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderDirectory()
    await user.click(await screen.findByRole('button', { name: 'Edit Bina Analyst' }))
    await user.type(await screen.findByLabelText('Designation'), ' II')
    await act(async () => { await user.click(screen.getByTestId('person-row-orgPerson-p1')) })
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByLabelText('Designation')).toHaveValue('Analyst II')
    confirm.mockRestore()
  })

  it('keeps the draft when another person’s edit icon is clicked and the user stays', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderDirectory()
    await user.click(await screen.findByRole('button', { name: 'Edit Bina Analyst' }))
    await user.type(await screen.findByLabelText('Designation'), ' II')
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Edit Asha Lead' })) })
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByLabelText('Designation')).toHaveValue('Analyst II')
    confirm.mockRestore()
  })

  it('creates an Amnex employee without an email, so no sign-in or role comes with it', async () => {
    const user = userEvent.setup()
    renderDirectory()
    await user.click(await screen.findByRole('button', { name: 'New contact' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('New contact category')).toHaveValue('internal')
    await user.type(within(dialog).getByLabelText('Full name'), 'Chetan New')
    await user.selectOptions(within(dialog).getByLabelText('Department'), 'Legal')
    await user.click(within(dialog).getByRole('button', { name: 'Add contact' }))
    const input = vi.mocked(repository.createOrgPerson).mock.calls[0][0]
    expect(input).toMatchObject({ name: 'Chetan New', departments: ['Legal'], managerId: null })
    expect(input).not.toHaveProperty('email')
  })

  it('takes a competitor’s company from the Competitors list, and adds a missing one there', async () => {
    const user = userEvent.setup()
    renderDirectory()
    await user.click(await screen.findByRole('button', { name: 'New contact' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('New contact category'), 'competitor')
    const company = within(dialog).getByLabelText('Competitor company')
    await user.click(company)
    expect(await screen.findByRole('option', { name: 'Rival Co' })).toBeInTheDocument()
    await user.type(company, 'Newcomer Ltd')
    await user.click(screen.getByRole('button', { name: 'Add “Newcomer Ltd”' }))
    expect(repository.createCompetitor).toHaveBeenCalledWith({ name: 'Newcomer Ltd' })
    await user.type(within(dialog).getByLabelText('Email'), 'ravi@newcomer.com')
    await user.type(within(dialog).getByLabelText('Name'), 'Ravi')
    await user.click(within(dialog).getByRole('button', { name: 'Add contact' }))
    expect(data.createContact).toHaveBeenCalledWith({ email: 'ravi@newcomer.com', name: 'Ravi', party: 'competitor', organization: 'Newcomer Ltd', departmentId: null })
  })

  it('shows what a transfer changes before it is confirmed', async () => {
    const user = userEvent.setup()
    renderDirectory()
    await user.click(await screen.findByRole('button', { name: 'Transfer Asha Lead' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByLabelText('Destination departments'))
    await user.click(await screen.findByRole('checkbox', { name: /Pre-Sales/ }))
    await user.click(screen.getByRole('checkbox', { name: /^Legal/ }))
    const changes = within(dialog).getByRole('list', { name: 'What changes' })
    expect(changes).toHaveTextContent('Joins Legal.')
    expect(changes).toHaveTextContent('Leaves Pre-Sales.')
    expect(changes).toHaveTextContent('Their Pre-sales roster entry turns inactive; 1 active opportunity stays assigned to them')
    expect(changes).toHaveTextContent('Pre-Sales derives a sign-in role')
  })

  it('disables an action the role may not use, saying why', async () => {
    renderDirectory({ mode: 'enforce', email: 'me@amnex.com', roles: ['sales'], facts })
    const edit = await screen.findByRole('button', { name: 'Edit Asha Lead' })
    expect(edit).toBeDisabled()
  })
})

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'

const { people } = vi.hoisted(() => ({ people: [
  { id: 'p1', name: 'Asha Rao', designation: 'Director', level: 1, departments: ['Leadership'], managerId: null, email: 'asha@amnex.com', status: 'active', createdAt: '2026-01-01' },
  { id: 'p2', name: 'Bala Iyer', designation: 'Manager', level: 4, departments: ['Legal'], managerId: 'p1', email: '', status: 'active', createdAt: '2026-01-01' },
] }))
vi.mock('@/data/repository', () => ({
  repository: {
    listOrgPeople: vi.fn(), createOrgPerson: vi.fn(), updateOrgPerson: vi.fn(), deleteOrgPerson: vi.fn(), getMyAccess: vi.fn(),
    listDeliveryTeamMembers: vi.fn(), listSalesPersons: vi.fn(), listAmnexDepartments: vi.fn(), createAmnexDepartment: vi.fn(),
  },
}))
import { repository } from '@/data/repository'
import { OrgEmployees } from './OrgEmployees'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const as = (mode: 'off' | 'shadow' | 'enforce', role?: string) =>
  mode === 'off' ? { mode, email: null, roles: [], facts: null } : { mode, email: 'me@amnex.com', roles: [role as never], facts }
const renderAs = (access: ReturnType<typeof as>) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PermissionsProvider access={access as never}><OrgEmployees /></PermissionsProvider>
  </QueryClientProvider>,
)
const DEPARTMENTS = ['Leadership', 'Pre-Sales', 'Legal'].map((name, i) => ({ id: `d${i}`, name, systemKey: null, sortOrder: i, employeeCount: 0, createdAt: '', updatedAt: '' }))
const HELPER = /Used to derive this person's role\. Only System Admins can change it\./
const SERVER_REFUSAL = 'Only a System Admin can set or change an email address.'

beforeEach(() => {
  vi.mocked(repository.listOrgPeople).mockReset().mockResolvedValue(people as never)
  vi.mocked(repository.updateOrgPerson).mockReset().mockResolvedValue({} as never)
  vi.mocked(repository.createOrgPerson).mockReset().mockImplementation((async (input: { name: string }) => ({ id: 'new-' + input.name, name: input.name })) as never)
  vi.mocked(repository.listDeliveryTeamMembers).mockReset().mockResolvedValue([])
  vi.mocked(repository.listSalesPersons).mockReset().mockResolvedValue([])
  vi.mocked(repository.listAmnexDepartments).mockReset().mockResolvedValue(DEPARTMENTS as never)
})

describe('OrgEmployees — edit dialog and bulk import', () => {
  it('opens an Edit dialog that can rename someone, sending only what changed', async () => {
    renderAs(as('enforce', 'system_admin'))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Bala Iyer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Bala Iyer' })
    const name = within(dialog).getByLabelText('Full name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Bala S. Iyer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(repository.updateOrgPerson).toHaveBeenCalledWith('p2', { name: 'Bala S. Iyer' })
  })

  it('lets the Edit dialog add a profile photo, resized by the shared photo field, and sends it as photoUrl', async () => {
    renderAs(as('enforce', 'system_admin'))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Bala Iyer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Bala Iyer' })
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File([Uint8Array.from([137, 80, 78, 71])], 'me.png', { type: 'image/png' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(repository.updateOrgPerson).toHaveBeenCalledWith('p2', { photoUrl: expect.stringMatching(/^data:image\/png;base64,/) })
  })

  it('imports a CSV: previews every row, then creates the valid ones top-down with the manager resolved', async () => {
    renderAs(as('enforce', 'system_admin'))
    await userEvent.click(await screen.findByRole('button', { name: /Import/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Import employees' })
    const csv = ['Name,Level,Departments,Reports to', 'New Junior,L5,Legal,New Lead', 'New Lead,L3,Pre-Sales,Asha Rao', 'Asha Rao,L1,,', 'Broken,L2,Marketing,'].join(String.fromCharCode(10))
    await userEvent.upload(within(dialog).getByLabelText('Employee file'), new File([csv], 'people.csv', { type: 'text/csv' }))
    expect(await within(dialog).findByText(/Unknown department "Marketing"/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Already in the org/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import 2 people' }))
    expect(await within(dialog).findByText(/added/)).toBeInTheDocument()
    expect(vi.mocked(repository.createOrgPerson).mock.calls.map((c) => c[0])).toMatchObject([
      { name: 'New Lead', level: 3, managerId: 'p1', departments: ['Pre-Sales'] },
      { name: 'New Junior', level: 5, managerId: 'new-New Lead', departments: ['Legal'] },
    ])
  })

  it('does not offer Import to someone who cannot edit the org', async () => {
    renderAs(as('enforce', 'presales'))
    expect(await screen.findByRole('button', { name: /Import/ })).toBeDisabled()
  })
})

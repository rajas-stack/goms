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
const HELPER = /Used to derive this person's role\. Only System Admins can change it\./
const SERVER_REFUSAL = 'Only a System Admin can set or change an email address.'

beforeEach(() => {
  vi.mocked(repository.listOrgPeople).mockReset().mockResolvedValue(people as never)
  vi.mocked(repository.updateOrgPerson).mockReset().mockResolvedValue({} as never)
  vi.mocked(repository.createOrgPerson).mockReset().mockResolvedValue({} as never)
})

describe('OrgEmployees — email (System Admin only; the server enforces it)', () => {
  it('lets a System Admin edit a person\'s email, sending only the email in that change', async () => {
    renderAs(as('enforce', 'system_admin'))
    const input = await screen.findByLabelText('Asha Rao email')
    expect(input).toHaveValue('asha@amnex.com')
    await userEvent.clear(input)
    await userEvent.type(input, 'asha.rao@amnex.com')
    await userEvent.tab()
    expect(repository.updateOrgPerson).toHaveBeenCalledWith('p1', { email: 'asha.rao@amnex.com' })
  })

  it('does not send an email that did not change (re-focusing, or a change of case only)', async () => {
    renderAs(as('enforce', 'system_admin'))
    const input = await screen.findByLabelText('Asha Rao email')
    await userEvent.click(input)
    await userEvent.tab()
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, 'ASHA@amnex.com')
    await userEvent.tab()
    expect(repository.updateOrgPerson).not.toHaveBeenCalled()
  })

  it('leaves the email out of every other change, so those keep working for roles that cannot change it', async () => {
    renderAs(as('enforce', 'system_admin'))
    const designation = await screen.findByLabelText('Asha Rao designation')
    await userEvent.clear(designation)
    await userEvent.type(designation, 'Chief')
    await userEvent.tab()
    expect(repository.updateOrgPerson).toHaveBeenCalledWith('p1', { designation: 'Chief' })
  })

  it('shows CXO the email as plain text ("—" when empty) with the helper line, and still lets them edit other fields', async () => {
    renderAs(as('enforce', 'cxo'))
    const row = (await screen.findByText('Asha Rao')).closest('tr')!
    expect(within(row).getByText('asha@amnex.com')).toBeInTheDocument()
    expect(within(screen.getByText('Bala Iyer').closest('tr')!).getByText('—')).toBeInTheDocument()
    expect(screen.queryByLabelText('Asha Rao email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('New employee email')).not.toBeInTheDocument()
    expect(screen.getByText(HELPER)).toBeInTheDocument()
    const designation = screen.getByLabelText('Asha Rao designation')
    await userEvent.clear(designation)
    await userEvent.type(designation, 'Chief')
    await userEvent.tab()
    expect(repository.updateOrgPerson).toHaveBeenCalledWith('p1', { designation: 'Chief' })
  })

  it('treats shadow like enforce: the server reported the roles, so a CXO is read-only and a System Admin can edit', async () => {
    const cxo = renderAs(as('shadow', 'cxo'))
    await screen.findByText('Asha Rao')
    expect(screen.queryByLabelText('Asha Rao email')).not.toBeInTheDocument()
    cxo.unmount()
    renderAs(as('shadow', 'system_admin'))
    expect(await screen.findByLabelText('Asha Rao email')).toBeInTheDocument()
  })

  it('with RBAC off the server cannot say who is a System Admin, so the field stays editable and the server decides', async () => {
    renderAs(as('off'))
    expect(await screen.findByLabelText('Asha Rao email')).toBeInTheDocument()
  })

  it('shows the server\'s refusal and puts the stored email back', async () => {
    vi.mocked(repository.updateOrgPerson).mockRejectedValue(Object.assign(new Error(SERVER_REFUSAL), { data: { code: 'FORBIDDEN', rbacDenied: true } }))
    renderAs(as('off'))
    const input = await screen.findByLabelText('Asha Rao email')
    await userEvent.clear(input)
    await userEvent.type(input, 'someone.else@amnex.com')
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_REFUSAL)
    expect(await screen.findByLabelText('Asha Rao email')).toHaveValue('asha@amnex.com')
  })

  it('lets a System Admin add a person with an email, and sends no email when none is typed', async () => {
    renderAs(as('enforce', 'system_admin'))
    await screen.findByText('Asha Rao')
    await userEvent.type(screen.getByPlaceholderText('Employee name'), 'Chitra')
    await userEvent.type(screen.getByLabelText('New employee email'), 'chitra@amnex.com')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(repository.createOrgPerson).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chitra', email: 'chitra@amnex.com' }))

    await userEvent.type(screen.getByPlaceholderText('Employee name'), 'Deepa')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    const second = vi.mocked(repository.createOrgPerson).mock.calls[1][0]
    expect(second.name).toBe('Deepa')
    expect(second).not.toHaveProperty('email')
  })
})

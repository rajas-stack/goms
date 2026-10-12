import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'

const { members } = vi.hoisted(() => ({ members: [
  { id: 'm1', team: 'preSales', name: 'Hand Added', email: 'hand@amnex.com', designation: 'Analyst', status: 'active', managerId: null, orgPersonId: null, createdAt: '2026-01-01' },
  { id: 'm2', team: 'preSales', name: 'Org Linked', email: 'linked@amnex.com', designation: 'Lead', status: 'active', managerId: null, orgPersonId: 'p1', createdAt: '2026-01-01' },
  { id: 'm3', team: 'preSales', name: 'No Email', email: '', designation: '', status: 'active', managerId: null, orgPersonId: null, createdAt: '2026-01-01' },
] }))
vi.mock('@/data/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/repository')>()),
  repository: { listDeliveryTeamMembers: vi.fn(), updateDeliveryTeamMember: vi.fn(), getMyAccess: vi.fn() },
}))
import { repository } from '@/data/repository'
import { TeamRoster } from './TeamsWorkspace'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const as = (mode: 'off' | 'shadow' | 'enforce', role?: string) =>
  mode === 'off' ? { mode, email: null, roles: [], facts: null } : { mode, email: 'me@amnex.com', roles: [role as never], facts }
const renderAs = (access: ReturnType<typeof as>) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PermissionsProvider access={access as never}><MemoryRouter><TeamRoster team="preSales" /></MemoryRouter></PermissionsProvider>
  </QueryClientProvider>,
)
const HELPER = /Used to derive this person's role\. Only System Admins can change it\./
const SERVER_REFUSAL = 'Only a System Admin can set or change an email address.'

beforeEach(() => {
  vi.mocked(repository.listDeliveryTeamMembers).mockReset().mockResolvedValue(members as never)
  vi.mocked(repository.updateDeliveryTeamMember).mockReset().mockResolvedValue({} as never)
})

describe('TeamRoster — member email (System Admin only; the server enforces it)', () => {
  it('lets a System Admin change a hand-added member\'s email, sending only the email', async () => {
    renderAs(as('enforce', 'system_admin'))
    const input = await screen.findByLabelText('Hand Added email')
    expect(input).toHaveValue('hand@amnex.com')
    await userEvent.clear(input)
    await userEvent.type(input, 'hand.added@amnex.com')
    await userEvent.tab()
    expect(repository.updateDeliveryTeamMember).toHaveBeenCalledWith('m1', { email: 'hand.added@amnex.com' })
  })

  it('does not send an email that did not change', async () => {
    renderAs(as('enforce', 'system_admin'))
    const input = await screen.findByLabelText('Hand Added email')
    await userEvent.click(input)
    await userEvent.tab()
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, 'HAND@amnex.com')
    await userEvent.tab()
    expect(repository.updateDeliveryTeamMember).not.toHaveBeenCalled()
  })

  it('leaves an org-linked member\'s email to the org person: read-only text even for a System Admin', async () => {
    renderAs(as('enforce', 'system_admin'))
    await screen.findByLabelText('Hand Added email')
    expect(screen.queryByLabelText('Org Linked email')).not.toBeInTheDocument()
    expect(within(screen.getByText('Org Linked').closest('li')!).getByText(/linked@amnex\.com/)).toBeInTheDocument()
  })

  it('shows CXO every email as text ("—" when empty) and the helper line, with no field to change it', async () => {
    renderAs(as('enforce', 'cxo'))
    const hand = (await screen.findByText('Hand Added')).closest('li')!
    expect(within(hand).getByText('hand@amnex.com')).toBeInTheDocument()
    expect(within(screen.getByText('No Email').closest('li')!).getByText('—')).toBeInTheDocument()
    expect(screen.queryByLabelText('Hand Added email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('No Email email')).not.toBeInTheDocument()
    expect(screen.getByText(HELPER)).toBeInTheDocument()
  })

  it('treats shadow like enforce, and leaves the field editable with RBAC off (the server decides)', async () => {
    const cxo = renderAs(as('shadow', 'cxo'))
    await screen.findByText('Hand Added')
    expect(screen.queryByLabelText('Hand Added email')).not.toBeInTheDocument()
    cxo.unmount()
    const off = renderAs(as('off'))
    expect(await screen.findByLabelText('Hand Added email')).toBeInTheDocument()
    off.unmount()
    renderAs(as('shadow', 'system_admin'))
    expect(await screen.findByLabelText('Hand Added email')).toBeInTheDocument()
  })

  it('shows the server\'s refusal and puts the stored email back', async () => {
    vi.mocked(repository.updateDeliveryTeamMember).mockRejectedValue(Object.assign(new Error(SERVER_REFUSAL), { data: { code: 'FORBIDDEN', rbacDenied: true } }))
    renderAs(as('off'))
    const input = await screen.findByLabelText('Hand Added email')
    await userEvent.clear(input)
    await userEvent.type(input, 'someone.else@amnex.com')
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_REFUSAL)
    expect(await screen.findByLabelText('Hand Added email')).toHaveValue('hand@amnex.com')
  })

  it('does not send an email with no @, shows a message and puts the stored email back', async () => {
    renderAs(as('enforce', 'system_admin'))
    const input = await screen.findByLabelText('Hand Added email')
    await userEvent.clear(input)
    await userEvent.type(input, 'not an email')
    await userEvent.tab()
    expect(repository.updateDeliveryTeamMember).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs an @/i)
    expect(await screen.findByLabelText('Hand Added email')).toHaveValue('hand@amnex.com')
  })

  it('asks before clearing an email: cancel keeps it, OK sends the clear', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderAs(as('enforce', 'system_admin'))
    let input = await screen.findByLabelText('Hand Added email')
    await userEvent.clear(input)
    await userEvent.tab()
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Hand Added/))
    expect(repository.updateDeliveryTeamMember).not.toHaveBeenCalled()
    input = await screen.findByLabelText('Hand Added email')
    expect(input).toHaveValue('hand@amnex.com')

    confirm.mockReturnValue(true)
    await userEvent.clear(input)
    await userEvent.tab()
    expect(repository.updateDeliveryTeamMember).toHaveBeenCalledWith('m1', { email: '' })
    confirm.mockRestore()
  })

  it('a refused edit in one row does not reset another row unsaved email input', async () => {
    const hand2 = { ...members[0], id: 'm4', name: 'Second Hand', email: 'second@amnex.com' }
    vi.mocked(repository.listDeliveryTeamMembers).mockResolvedValue([members[0], hand2] as never)
    let refuse!: (e: Error) => void
    vi.mocked(repository.updateDeliveryTeamMember).mockImplementation(() => new Promise((_, reject) => { refuse = reject }) as never)
    renderAs(as('enforce', 'system_admin'))
    const a = await screen.findByLabelText('Hand Added email')
    await userEvent.clear(a)
    await userEvent.type(a, 'someone.else@amnex.com')
    await userEvent.tab() // row A's save is now in flight
    const b = screen.getByLabelText('Second Hand email')
    await userEvent.type(b, '.x')
    refuse(Object.assign(new Error(SERVER_REFUSAL), { data: { code: 'FORBIDDEN', rbacDenied: true } }))
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_REFUSAL)
    expect(await screen.findByLabelText('Hand Added email')).toHaveValue('hand@amnex.com')
    expect(screen.getByLabelText('Second Hand email')).toHaveValue('second@amnex.com.x')
  })

  it('shows no email helper when every member follows the org', async () => {
    vi.mocked(repository.listDeliveryTeamMembers).mockResolvedValue([members[1]] as never)
    renderAs(as('enforce', 'cxo'))
    await screen.findByText('Org Linked')
    expect(screen.queryByText(HELPER)).not.toBeInTheDocument()
  })
})

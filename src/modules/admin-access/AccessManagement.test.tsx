import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'
import { formatWhen } from './format'
import { historyFixture, matrixFixture, sellerPermissions, unmatchedFixture } from './testFixtures'

// vi.mock is hoisted above plain consts, so the fixture must be hoisted with it
const { readiness } = vi.hoisted(() => ({ readiness: [
  { key: 'org:1', kind: 'org', name: 'Denish', email: 'denish@amnex.com', derivedRoles: ['legal'], overrides: [], effectiveRoles: ['legal'], warnings: [], lastSeenAt: null },
  { key: 'org:2', kind: 'org', name: 'Nirav Shah', email: '', derivedRoles: [], overrides: [], effectiveRoles: [], warnings: ['no-email', 'no-role'], lastSeenAt: null },
] }))
vi.mock('@/data/repository', () => ({
  repository: {
    getAccessReadiness: vi.fn(),
    listRoleOverrides: vi.fn(),
    setRoleOverride: vi.fn(),
    removeRoleOverride: vi.fn(),
    listUnmatchedOverrides: vi.fn(),
    listOverrideHistory: vi.fn(),
    getPermissionMatrix: vi.fn(),
    getEffectivePermissions: vi.fn(),
    getMyAccess: vi.fn(),
  },
}))
import { repository } from '@/data/repository'
import { AccessManagement } from './AccessManagement'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const forbidden = (message: string) => Object.assign(new Error(message), { data: { code: 'FORBIDDEN' } })
const renderWith = (access: any) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PermissionsProvider access={access}><AccessManagement /></PermissionsProvider>
    </QueryClientProvider>,
  )
const renderAs = (roles: any[], mode: 'enforce' | 'shadow' = 'enforce') => renderWith({ mode, email: 'me@amnex.com', roles, facts })
/** RBAC off: the server reports no roles, so only a successful readiness read says the viewer passed the allow-list gate. */
const renderRbacOff = () => renderWith({ mode: 'off', email: null, roles: [], facts: null })

const chipOverride = { id: 'o1', role: 'finance', effect: 'grant', reason: 'Covering payroll', createdBy: 'root@amnex.com', createdAt: '2026-10-01T10:30:00.000Z' }
const withChip = [{ ...readiness[0], overrides: [chipOverride], effectiveRoles: ['legal', 'finance'] }, readiness[1]]

beforeEach(() => {
  vi.mocked(repository.getAccessReadiness).mockReset().mockResolvedValue(readiness as any)
  vi.mocked(repository.listRoleOverrides).mockReset().mockResolvedValue([])
  vi.mocked(repository.setRoleOverride).mockReset().mockResolvedValue(undefined)
  vi.mocked(repository.removeRoleOverride).mockReset().mockResolvedValue(undefined)
  vi.mocked(repository.listUnmatchedOverrides).mockReset().mockResolvedValue([])
  vi.mocked(repository.listOverrideHistory).mockReset().mockResolvedValue([])
  vi.mocked(repository.getPermissionMatrix).mockReset().mockResolvedValue(matrixFixture())
  vi.mocked(repository.getEffectivePermissions).mockReset().mockResolvedValue(sellerPermissions)
})

describe('AccessManagement', () => {
  it('lists people with their effective roles and flags what needs attention', async () => {
    renderAs(['it'])
    expect(await screen.findByText('Denish')).toBeInTheDocument()
    const row = screen.getByText('Nirav Shah').closest('tr')!
    expect(within(row).getByText(/no email/i)).toBeInTheDocument()
    expect(within(row).getByText(/no role/i)).toBeInTheDocument()
  })
  it('lets a System Admin grant a role with a reason', async () => {
    renderAs(['system_admin'])
    await screen.findByText('Denish')
    await userEvent.type(screen.getByLabelText('Email'), 'nirav@amnex.com')
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'cxo')
    await userEvent.type(screen.getByLabelText('Reason'), 'CEO')
    await userEvent.click(screen.getByRole('button', { name: /save override/i }))
    expect(repository.setRoleOverride).toHaveBeenCalledWith({ email: 'nirav@amnex.com', role: 'cxo', effect: 'grant', reason: 'CEO' })
  })
  it('is read-only for CXO', async () => {
    renderAs(['cxo'])
    await screen.findByText('Denish')
    expect(screen.queryByRole('button', { name: /save override/i })).not.toBeInTheDocument()
  })
  it('shows System Admin accounts as protected, with no way to remove or override them, even for a System Admin', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValueOnce([
      { key: 'admin:root', kind: 'admin', name: 'root@amnex.com', email: 'root@amnex.com', derivedRoles: [], overrides: [], effectiveRoles: ['system_admin'], systemAdmin: true, warnings: [], lastSeenAt: null },
      { ...withChip[0], key: 'org:9', name: 'Priya' },
    ] as any)
    renderAs(['system_admin'])
    const row = (await screen.findByText('root@amnex.com', { selector: 'td' })).closest('tr')!
    expect(within(row).getByText(/system admin \(protected\)/i)).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    // the same System Admin can remove an ordinary person's override
    expect(within(screen.getByText('Priya').closest('tr')!).getByRole('button', { name: /remove finance override/i })).toBeInTheDocument()
  })
  it('shows an ambiguous team member and a duplicate email as readable warnings', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValueOnce([
      { key: 'team:dup@amnex.com', kind: 'team', name: 'Pre-sales twin', email: 'dup@amnex.com', derivedRoles: [], overrides: [], effectiveRoles: [], warnings: ['no-role', 'duplicate-email', 'ambiguous-team-member'], lastSeenAt: null },
    ] as any)
    renderAs(['it'])
    const row = (await screen.findByText('Pre-sales twin')).closest('tr')!
    expect(within(row).getByText('Ambiguous team member')).toBeInTheDocument()
    expect(within(row).getByText('Duplicate email')).toBeInTheDocument()
  })
  it('does not offer System Admin as a role to grant', async () => {
    renderAs(['system_admin'])
    await screen.findByText('Denish')
    const options = within(screen.getByLabelText('Role')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('CXO')
    expect(options).not.toContain('System Admin')
  })
})

describe('AccessManagement: only a System Admin changes overrides (UX; the server enforces it)', () => {
  it.each([['IT', ['it']], ['CXO', ['cxo']]] as const)('hides the add form and every remove control from %s, with a short note, and still shows the data', async (_label, roles) => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValue(withChip as any)
    vi.mocked(repository.listUnmatchedOverrides).mockResolvedValue(unmatchedFixture)
    renderAs([...roles])
    const row = (await screen.findByText('Denish')).closest('tr')!
    expect(await screen.findByText('ghost@amnex.com')).toBeInTheDocument() // unmatched section still lists
    expect(screen.getByText(/only system admins can change overrides/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save override/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /^remove /i })).toHaveLength(0)
    expect(within(row).getByTitle(/Covering payroll/)).toBeInTheDocument() // the chip itself is visible read-only
  })
  it('shows the add form and the remove controls to a System Admin, without the read-only note', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValue(withChip as any)
    vi.mocked(repository.listUnmatchedOverrides).mockResolvedValue(unmatchedFixture)
    renderAs(['system_admin'])
    await screen.findByText('Denish')
    expect(screen.getByRole('button', { name: /save override/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /remove finance override for ghost@amnex.com/i })).toBeInTheDocument()
    expect(screen.queryByText(/only system admins can change overrides/i)).not.toBeInTheDocument()
  })
  it('treats the viewer as a System Admin in shadow mode when the server reported that role', async () => {
    renderAs(['system_admin'], 'shadow')
    await screen.findByText('Denish')
    expect(screen.getByRole('button', { name: /save override/i })).toBeInTheDocument()
  })
  it('does not treat IT as a System Admin in shadow mode just because IT can read the screen', async () => {
    renderAs(['it'], 'shadow')
    await screen.findByText('Denish')
    expect(screen.queryByRole('button', { name: /save override/i })).not.toBeInTheDocument()
    expect(screen.getByText(/only system admins can change overrides/i)).toBeInTheDocument()
  })
  it('with RBAC off, a viewer whose readiness read succeeded passed the server\'s allow-list gate and gets the controls', async () => {
    renderRbacOff()
    await screen.findByText('Denish')
    expect(await screen.findByRole('button', { name: /save override/i })).toBeInTheDocument()
  })
  it('with RBAC off, the controls stay hidden while readiness has not succeeded', async () => {
    vi.mocked(repository.getAccessReadiness).mockReturnValue(new Promise(() => {}))
    renderRbacOff()
    expect((await screen.findAllByText(/loading/i)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /save override/i })).not.toBeInTheDocument()
  })
})

describe('AccessManagement: removing an override', () => {
  it('asks for confirmation, then removes it by id', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValue(withChip as any)
    renderAs(['system_admin'])
    const row = (await screen.findByText('Denish')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: /remove finance override/i }))
    const dialog = await screen.findByRole('dialog', { name: /remove override/i })
    expect(dialog).toHaveTextContent('denish@amnex.com')
    expect(repository.removeRoleOverride).not.toHaveBeenCalled() // nothing yet: it is a confirmation
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(repository.removeRoleOverride).toHaveBeenCalledWith('o1')
  })
  it('words each chip remove button with the person, so the labels are unique across rows', async () => {
    const twoChips = [withChip[0], { ...readiness[1], overrides: [{ ...chipOverride, id: 'o2' }], effectiveRoles: ['finance'] }]
    vi.mocked(repository.getAccessReadiness).mockResolvedValue(twoChips as any)
    renderAs(['system_admin'])
    await screen.findByText('Denish')
    const labels = screen.getAllByRole('button', { name: /^remove finance override for /i }).map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Remove Finance override for Denish', 'Remove Finance override for Nirav Shah'])
  })
  it('does nothing when the confirmation is cancelled', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValue(withChip as any)
    renderAs(['system_admin'])
    const row = (await screen.findByText('Denish')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: /remove finance override/i }))
    const dialog = await screen.findByRole('dialog', { name: /remove override/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(repository.removeRoleOverride).not.toHaveBeenCalled()
  })
  it('keeps the dialog open and shows the server message when the removal is refused', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValue(withChip as any)
    vi.mocked(repository.removeRoleOverride).mockRejectedValue(forbidden('Only a System Admin can do this.'))
    renderAs(['system_admin'])
    const row = (await screen.findByText('Denish')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: /remove finance override/i }))
    const dialog = await screen.findByRole('dialog', { name: /remove override/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only a System Admin can do this.')
    expect(screen.getByRole('dialog', { name: /remove override/i })).toBeInTheDocument()
  })
  it('shows who set an override and when, on the chip', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValue(withChip as any)
    renderAs(['cxo'])
    await screen.findByText('Denish')
    expect(screen.getByTitle(`Covering payroll. Set by root@amnex.com on ${formatWhen('2026-10-01T10:30:00.000Z')}`)).toBeInTheDocument()
  })
})

describe('AccessManagement: overrides not matched to a person', () => {
  it('lists each one with its role, grant or revoke, reason, who set it and when', async () => {
    vi.mocked(repository.listUnmatchedOverrides).mockResolvedValue(unmatchedFixture)
    renderAs(['cxo'])
    const section = await screen.findByRole('region', { name: /overrides not matched to a person/i })
    const ghost = (await within(section).findByText('ghost@amnex.com')).closest('tr')!
    expect(ghost).toHaveTextContent('Finance')
    expect(ghost).toHaveTextContent('Grant')
    expect(ghost).toHaveTextContent('Covering for payroll')
    expect(ghost).toHaveTextContent('root@amnex.com')
    expect(ghost).toHaveTextContent(formatWhen('2026-10-01T10:30:00.000Z'))
    const gone = within(section).getByText('gone@amnex.com').closest('tr')!
    expect(gone).toHaveTextContent('Legal')
    expect(gone).toHaveTextContent('Revoke')
  })
  it('lets a System Admin remove one (after confirming) and offers CXO no remove control for it', async () => {
    vi.mocked(repository.listUnmatchedOverrides).mockResolvedValue(unmatchedFixture)
    const admin = renderAs(['system_admin'])
    await userEvent.click(await screen.findByRole('button', { name: /remove finance override for ghost@amnex.com/i }))
    const dialog = await screen.findByRole('dialog', { name: /remove override/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(repository.removeRoleOverride).toHaveBeenCalledWith('u1')
    admin.unmount()
    renderAs(['cxo'])
    await screen.findByText('ghost@amnex.com')
    expect(screen.queryByRole('button', { name: /remove .* override for/i })).not.toBeInTheDocument()
  })
  it('has an explicit empty state', async () => {
    renderAs(['system_admin'])
    const section = await screen.findByRole('region', { name: /overrides not matched to a person/i })
    expect(await within(section).findByText(/every override belongs to a person/i)).toBeInTheDocument()
  })
})

describe('AccessManagement: effective permissions, history and the matrix', () => {
  it('opens the server-computed effective permissions for a person who has an email, and offers it to nobody without one', async () => {
    renderAs(['cxo'])
    const row = (await screen.findByText('Denish')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: /effective permissions/i }))
    const dialog = await screen.findByRole('dialog', { name: /effective permissions/i })
    expect(await within(dialog).findByRole('table', { name: /permissions by module/i })).toBeInTheDocument()
    expect(repository.getEffectivePermissions).toHaveBeenCalledWith('denish@amnex.com')
    expect(within(screen.getByText('Nirav Shah').closest('tr')!).queryByRole('button', { name: /effective permissions/i })).not.toBeInTheDocument()
  })
  it('shows the override history of one person from their row', async () => {
    vi.mocked(repository.listOverrideHistory).mockResolvedValue(historyFixture)
    renderAs(['cxo'])
    const row = (await screen.findByText('Denish')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: /^history for denish/i }))
    const dialog = await screen.findByRole('dialog', { name: /override history/i })
    expect(await within(dialog).findByRole('table', { name: /override history/i })).toBeInTheDocument()
    expect(repository.listOverrideHistory).toHaveBeenCalledWith({ email: 'denish@amnex.com' })
  })
  it('lists the overall override history on the page', async () => {
    vi.mocked(repository.listOverrideHistory).mockResolvedValue(historyFixture)
    renderAs(['cxo'])
    const section = await screen.findByRole('region', { name: /^override history$/i })
    expect(await within(section).findByRole('table', { name: /override history/i })).toBeInTheDocument()
    expect(repository.listOverrideHistory).toHaveBeenCalledWith({})
  })
  it('switches between the people table and the permission matrix', async () => {
    renderAs(['cxo'])
    await screen.findByText('Denish')
    expect(screen.queryByRole('table', { name: /permission matrix/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Permission matrix' }))
    expect(await screen.findByRole('table', { name: /permission matrix/i })).toBeInTheDocument()
    expect(screen.queryByText('Denish')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'People & overrides' }))
    expect(await screen.findByText('Denish')).toBeInTheDocument()
  })
})

describe('AccessManagement: a refused viewer', () => {
  it('shows a clear message instead of an empty table when the server answers FORBIDDEN', async () => {
    vi.mocked(repository.getAccessReadiness).mockRejectedValue(forbidden('Your account is not authorized to manage access.'))
    renderRbacOff()
    expect(await screen.findByText('Only System Admins can manage access')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save override/i })).not.toBeInTheDocument()
  })
  it('shows the message for any other failure as an alert, not as an empty table', async () => {
    vi.mocked(repository.getAccessReadiness).mockRejectedValue(new Error('boom'))
    renderAs(['it'])
    // one automatic retry (about a second), then the failure is shown rather than an empty table
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/could not load/i)
    expect(screen.queryByText('Only System Admins can manage access')).not.toBeInTheDocument()
  }, 10000)
  it('shows an explicit empty state when there are no people', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValue([])
    renderAs(['it'])
    expect(await screen.findByText(/no people to show/i)).toBeInTheDocument()
  })
})

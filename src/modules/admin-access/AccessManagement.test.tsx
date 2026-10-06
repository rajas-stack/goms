import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'

// vi.mock is hoisted above plain consts, so the fixture must be hoisted with it
const { readiness } = vi.hoisted(() => ({ readiness: [
  { key: 'org:1', kind: 'org', name: 'Denish', email: 'denish@amnex.com', derivedRoles: ['legal'], overrides: [], effectiveRoles: ['legal'], warnings: [], lastSeenAt: null },
  { key: 'org:2', kind: 'org', name: 'Nirav Shah', email: '', derivedRoles: [], overrides: [], effectiveRoles: [], warnings: ['no-email', 'no-role'], lastSeenAt: null },
] }))
vi.mock('@/data/repository', () => ({
  repository: {
    getAccessReadiness: vi.fn().mockResolvedValue(readiness),
    listRoleOverrides: vi.fn().mockResolvedValue([]),
    setRoleOverride: vi.fn().mockResolvedValue({}),
    removeRoleOverride: vi.fn().mockResolvedValue(undefined),
    getMyAccess: vi.fn(),
  },
}))
import { repository } from '@/data/repository'
import { AccessManagement } from './AccessManagement'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const renderAs = (roles: any[]) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PermissionsProvider access={{ mode: 'enforce', email: 'it@amnex.com', roles, facts }}><AccessManagement /></PermissionsProvider>
    </QueryClientProvider>,
  )

describe('AccessManagement', () => {
  it('lists people with their effective roles and flags what needs attention', async () => {
    renderAs(['it'])
    expect(await screen.findByText('Denish')).toBeInTheDocument()
    const row = screen.getByText('Nirav Shah').closest('tr')!
    expect(within(row).getByText(/no email/i)).toBeInTheDocument()
    expect(within(row).getByText(/no role/i)).toBeInTheDocument()
  })
  it('lets IT grant a role with a reason', async () => {
    renderAs(['it'])
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
  it('shows System Admin accounts as protected, with no way to remove or override them', async () => {
    vi.mocked(repository.getAccessReadiness).mockResolvedValueOnce([
      { key: 'admin:root', kind: 'admin', name: 'root@amnex.com', email: 'root@amnex.com', derivedRoles: [], overrides: [], effectiveRoles: ['system_admin'], systemAdmin: true, warnings: [], lastSeenAt: null },
    ] as any)
    renderAs(['it'])
    const row = (await screen.findByText('root@amnex.com', { selector: 'td' })).closest('tr')!
    expect(within(row).getByText(/system admin \(protected\)/i)).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
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
    renderAs(['it'])
    await screen.findByText('Denish')
    const options = within(screen.getByLabelText('Role')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('CXO')
    expect(options).not.toContain('System Admin')
  })
})

import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { itPermissions, rootPermissions, sellerPermissions } from './testFixtures'

vi.mock('@/data/repository', () => ({ repository: { getEffectivePermissions: vi.fn(), getMyAccess: vi.fn() } }))
import { repository } from '@/data/repository'
import { EffectivePermissionsPanel } from './EffectivePermissionsPanel'

const renderPanel = (email: string | null = 'seller@amnex.com', onClose = vi.fn()) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <EffectivePermissionsPanel email={email} name="Sam Seller" onClose={onClose} />
  </QueryClientProvider>,
)
const moduleRow = (label: string) => screen.getByRole('rowheader', { name: new RegExp(label) }).closest('tr')!

describe('EffectivePermissionsPanel', () => {
  it('asks the server about this person and shows their roles, notes and what they can do per module', async () => {
    vi.mocked(repository.getEffectivePermissions).mockResolvedValue(sellerPermissions)
    renderPanel()
    const dialog = await screen.findByRole('dialog', { name: /effective permissions/i })
    expect(await within(dialog).findByRole('table', { name: /permissions by module/i })).toBeInTheDocument()
    expect(repository.getEffectivePermissions).toHaveBeenCalledWith('seller@amnex.com')
    expect(within(dialog).getByText('Sam Seller')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Roles')).toHaveTextContent('Sales')
    expect(within(dialog).getByText(/limited to own or assigned rows depend on each row/i)).toBeInTheDocument()
    expect(moduleRow('SKU catalog & BOM')).toHaveTextContent('No access')
    expect(moduleRow('Pipeline rows')).toHaveTextContent('Read only')
  })

  it('shows rights limited to own or assigned rows as scoped entries, not as a module-wide level', async () => {
    vi.mocked(repository.getEffectivePermissions).mockResolvedValue(sellerPermissions)
    renderPanel()
    await screen.findByRole('table', { name: /permissions by module/i })
    expect(moduleRow('Pipeline rows')).toHaveTextContent('As Sales: Read + edit all · own rows only · Create')
    expect(moduleRow('SKU catalog & BOM')).not.toHaveTextContent('As Sales')
  })

  it('marks what stays System Admin only for a role that holds the matrix permission, with the reason', async () => {
    vi.mocked(repository.getEffectivePermissions).mockResolvedValue(itPermissions)
    renderPanel('it@amnex.com')
    await screen.findByRole('table', { name: /permissions by module/i })
    const access = moduleRow('Role & Access Management')
    expect(access).toHaveTextContent('Read + edit all')
    expect(within(access).getByText('System Admin only')).toBeInTheDocument()
    expect(access).toHaveTextContent('only a System Admin can create or change them')
    // an email-binding rule is listed with its reason, without turning the whole module System Admin only
    const org = moduleRow('Company Org Structure')
    expect(org).toHaveTextContent("only a System Admin can change it")
    expect(within(org).queryByText('System Admin only')).not.toBeInTheDocument()
    expect(within(moduleRow('SKU catalog & BOM')).queryByText('System Admin only')).not.toBeInTheDocument()
    expect(moduleRow('SKU catalog & BOM')).toHaveTextContent('Read + edit some fields (F1)')
  })

  it('does not mark Role & Access as System Admin only for someone with no access to it', async () => {
    vi.mocked(repository.getEffectivePermissions).mockResolvedValue(sellerPermissions)
    renderPanel()
    await screen.findByRole('table', { name: /permissions by module/i })
    expect(within(moduleRow('Role & Access Management')).queryByText('System Admin only')).not.toBeInTheDocument()
    expect(moduleRow('Role & Access Management')).toHaveTextContent('No access')
  })

  it('flags a System Admin as unrestricted, and does not flag anyone else', async () => {
    vi.mocked(repository.getEffectivePermissions).mockResolvedValue(rootPermissions)
    const { unmount } = renderPanel('root@amnex.com')
    expect(await screen.findByText('System Admin (unrestricted)')).toBeInTheDocument()
    unmount()
    vi.mocked(repository.getEffectivePermissions).mockResolvedValue(sellerPermissions)
    renderPanel()
    await screen.findByRole('table', { name: /permissions by module/i })
    expect(screen.queryByText('System Admin (unrestricted)')).not.toBeInTheDocument()
  })

  it('shows a loading state, then an alert with the server message when the call fails', async () => {
    vi.mocked(repository.getEffectivePermissions).mockRejectedValue(Object.assign(new Error('Your role cannot read this.'), { data: { code: 'FORBIDDEN' } }))
    renderPanel()
    expect(await screen.findByText(/loading permissions/i)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role cannot read this.')
    expect(screen.queryByRole('table', { name: /permissions by module/i })).not.toBeInTheDocument()
  })

  it('renders nothing and asks nothing while no person is selected', () => {
    vi.mocked(repository.getEffectivePermissions).mockClear()
    renderPanel(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(repository.getEffectivePermissions).not.toHaveBeenCalled()
  })
})

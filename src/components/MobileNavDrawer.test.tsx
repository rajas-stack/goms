import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { PermissionsProvider } from '@/lib/permissions'
import { ACCESS_NAV_CASES } from '@/test/accessNavCases'
import { MobileNavDrawer } from './MobileNavDrawer'

const { signedIn } = vi.hoisted(() => ({ signedIn: { value: false } }))
vi.mock('@/lib/useSignedIn', () => ({ useSignedIn: () => signedIn.value }))

const Where = () => <p data-testid="where">{useLocation().pathname}</p>
const renderDrawer = (access: Parameters<typeof PermissionsProvider>[0]['access'], onClose = vi.fn()) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PermissionsProvider access={access}>
      <MemoryRouter initialEntries={['/map']}><MobileNavDrawer open onClose={onClose} /><Where /></MemoryRouter>
    </PermissionsProvider>
  </QueryClientProvider>,
)

describe('MobileNavDrawer — Role & Access entry (same rule as the desktop rail; link visibility is not authorization)', () => {
  it.each(ACCESS_NAV_CASES)('$name: entry visible = $visible', async ({ access, signedIn: isSignedIn, visible }) => {
    signedIn.value = isSignedIn
    renderDrawer(access)
    const menu = await screen.findByRole('dialog', { name: 'Menu' })
    if (visible) expect(await screen.findByRole('button', { name: 'Role & Access' })).toBeInTheDocument()
    else expect(screen.queryByRole('button', { name: 'Role & Access' })).not.toBeInTheDocument()
    expect(menu).toBeInTheDocument()
  })

  it('closes the menu and opens the Role & Access screen when tapped', async () => {
    signedIn.value = true
    const onClose = vi.fn()
    renderDrawer({ mode: 'enforce', email: 'root@amnex.com', roles: ['system_admin'], facts: { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } } }, onClose)
    await userEvent.click(await screen.findByRole('button', { name: 'Role & Access' }))
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/access')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

describe('MobileNavDrawer — Role & Access moved to Settings', () => {
  it.each(ACCESS_NAV_CASES)('$name: no Role & Access entry in the menu', async ({ access, signedIn: isSignedIn }) => {
    signedIn.value = isSignedIn
    renderDrawer(access)
    expect(await screen.findByRole('dialog', { name: 'Menu' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Role & Access' })).not.toBeInTheDocument()
  })
})

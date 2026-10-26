import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { PermissionsProvider } from '@/lib/permissions'
import { ACCESS_NAV_CASES } from '@/test/accessNavCases'
import { AccountMappingRail } from './AccountMappingRail'
import { NodeAccessProvider } from '@/lib/rbacTree/access'
import type { RbacMyAccess } from '@goms/domain'

// Whether the viewer is signed in comes from Firebase; the tests decide it directly.
const { signedIn } = vi.hoisted(() => ({ signedIn: { value: false } }))
vi.mock('@/lib/useSignedIn', () => ({ useSignedIn: () => signedIn.value }))

function renderRail(path = '/map') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccountMappingRail />
    </MemoryRouter>,
  )
}

describe('AccountMappingRail — Live Bids entry', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hides the Live Bids button while the build flag is off', () => {
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', '')
    renderRail()
    expect(screen.queryByTitle('Opportunity')).not.toBeInTheDocument()
  })

  it('shows the Live Bids button when the flag is on, and marks it active on its routes', () => {
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', 'true')
    renderRail('/live-bids/actions')
    const button = screen.getByTitle('Opportunity')
    expect(button.className).toContain('shadow-sm')
    expect(screen.getByTitle('Account Mapping').className).not.toContain('shadow-sm')
  })
})

const Where = () => <p data-testid="where">{useLocation().pathname}</p>

describe('AccountMappingRail — Role & Access moved to Settings', () => {
  const renderWith = (access: Parameters<typeof PermissionsProvider>[0]['access'], tree?: RbacMyAccess) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PermissionsProvider access={access}>
        <NodeAccessProvider access={tree}>
          <MemoryRouter initialEntries={['/map']}><AccountMappingRail /><Where /></MemoryRouter>
        </NodeAccessProvider>
      </PermissionsProvider>
    </QueryClientProvider>,
  )

  it.each(ACCESS_NAV_CASES)('$name: no Role & Access entry in the rail', ({ access, signedIn: isSignedIn }) => {
    signedIn.value = isSignedIn
    renderWith(access)
    expect(screen.queryByTitle('Role & Access')).not.toBeInTheDocument()
  })

  it('hides a module the permission tree denies, keeps the others', () => {
    const tree: RbacMyAccess = { configured: true, allowed: { commercial: 0, accountMapping: 63 } }
    renderWith({ mode: 'off', email: null, roles: [], facts: null }, tree)
    expect(screen.queryByTitle('Commercial Calculator')).not.toBeInTheDocument()
    expect(screen.getByTitle('Account Mapping')).toBeInTheDocument()
  })
})

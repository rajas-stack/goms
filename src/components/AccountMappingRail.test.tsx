import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { PermissionsProvider } from '@/lib/permissions'
import { ACCESS_NAV_CASES } from '@/test/accessNavCases'
import { AccountMappingRail } from './AccountMappingRail'

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

describe('AccountMappingRail — Bid Tracker entry', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hides the Bid Tracker button while the build flag is off', () => {
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', '')
    renderRail()
    expect(screen.queryByTitle('Opportunity')).not.toBeInTheDocument()
  })

  it('shows the Bid Tracker button when the flag is on, and marks it active on its routes', () => {
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', 'true')
    renderRail('/bid-tracker/actions')
    const button = screen.getByTitle('Opportunity')
    expect(button.className).toContain('shadow-sm')
    expect(screen.getByTitle('Account Mapping').className).not.toContain('shadow-sm')
  })
})

const Where = () => <p data-testid="where">{useLocation().pathname}</p>

describe('AccountMappingRail — Role & Access entry (link visibility only: the route guard and the server decide access)', () => {
  const renderWith = (access: Parameters<typeof PermissionsProvider>[0]['access'], path = '/map') => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PermissionsProvider access={access}>
        <MemoryRouter initialEntries={[path]}><AccountMappingRail /><Where /></MemoryRouter>
      </PermissionsProvider>
    </QueryClientProvider>,
  )

  it.each(ACCESS_NAV_CASES)('$name: entry visible = $visible', ({ access, signedIn: isSignedIn, visible }) => {
    signedIn.value = isSignedIn
    renderWith(access)
    if (visible) expect(screen.getByTitle('Role & Access')).toBeInTheDocument()
    else expect(screen.queryByTitle('Role & Access')).not.toBeInTheDocument()
  })

  it('opens the Role & Access screen and marks the entry active there', async () => {
    signedIn.value = true
    renderWith({ mode: 'enforce', email: 'root@amnex.com', roles: ['system_admin'], facts: { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } } })
    await userEvent.click(screen.getByTitle('Role & Access'))
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/access')
    expect(screen.getByTitle('Role & Access').className).toContain('shadow-sm')
  })
})

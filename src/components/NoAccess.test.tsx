import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'
import { RequireAccess } from './NoAccess'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const renderAs = (roles: any[]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PermissionsProvider access={{ mode: 'enforce', email: 'u@amnex.com', roles, facts }}>
        <MemoryRouter><RequireAccess anyOf={['com.skus']}><div>Catalog</div></RequireAccess></MemoryRouter>
      </PermissionsProvider>
    </QueryClientProvider>,
  )

describe('RequireAccess', () => {
  it('renders the page for a role that can read the module', () => {
    renderAs(['presales'])
    expect(screen.getByText('Catalog')).toBeInTheDocument()
  })
  it('renders every page for a System Admin', () => {
    renderAs(['system_admin'])
    expect(screen.getByText('Catalog')).toBeInTheDocument()
  })
  it('shows "No access" for a role that cannot', () => {
    renderAs(['legal'])
    expect(screen.queryByText('Catalog')).not.toBeInTheDocument()
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument()
  })
  it('shows the "No role assigned" screen for a user with no roles', () => {
    renderAs([])
    expect(screen.getByText(/no role assigned/i)).toBeInTheDocument()
  })
})

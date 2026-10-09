import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PermissionsProvider, usePermissions } from '@/lib/permissions'
import { readStoredRole } from '@/lib/activeRole'
import { resolveTheme, THEME_STORAGE_KEY } from '@/lib/theme'
import { OptionsMenu } from './OptionsMenu'

describe('resolveTheme', () => {
  it('follows the device only when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('OptionsMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  function openMenu() {
    render(<MemoryRouter><OptionsMenu /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Profile options' }))
  }

  it('switches the whole document to night mode and persists the choice', () => {
    openMenu()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /day mode/i }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(screen.getByRole('menuitemcheckbox', { name: /night mode/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('picks an explicit theme from the Light / Dark / System segments', () => {
    openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /light/i }))

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(screen.getByRole('menuitemradio', { name: /light/i })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggles day/night with Ctrl+Shift+L from anywhere', () => {
    render(<MemoryRouter><OptionsMenu /></MemoryRouter>)
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('opens Settings from the menu', () => {
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /DMS Settings/ })).toHaveAttribute('href', '/settings/dms')
    expect(screen.getByRole('link', { name: /Tender websites/ })).toHaveAttribute('href', '/settings/tender-websites')
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument()
  })
})

describe('OptionsMenu role switcher (narrows the UI only; the server still authorises)', () => {
  const facts = { salesPersonId: 'sp1', teamMemberIds: { presales: [], legal: [], bid: [] } }
  const access = (roles: string[], mode = 'enforce') => ({ mode, email: 'multi@amnex.com', roles, facts })

  function Effective() {
    const p = usePermissions()
    return <div data-testid="effective">{p.roles.join(',')}</div>
  }
  function renderMenu(a: unknown) {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PermissionsProvider access={a as never}>
          <MemoryRouter><OptionsMenu /><Effective /></MemoryRouter>
        </PermissionsProvider>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Profile options' }))
  }

  beforeEach(() => localStorage.clear())

  it('is hidden for a user with zero roles, one role, or while RBAC is not enforced', () => {
    for (const a of [access([]), access(['sales']), access(['sales', 'legal'], 'off'), access(['sales', 'legal'], 'shadow')]) {
      cleanup()
      renderMenu(a)
      expect(screen.queryByRole('group', { name: 'Role' })).not.toBeInTheDocument()
    }
  })

  it('lists exactly the roles the server reported, plus "All my roles", defaulting to All', () => {
    renderMenu(access(['sales', 'legal']))
    const group = screen.getByRole('group', { name: 'Role' })
    const options = within(group).getAllByRole('menuitemradio').map((o) => o.textContent)
    expect(options).toEqual(['All my roles', 'Sales', 'Legal'])
    expect(within(group).getByRole('menuitemradio', { name: 'All my roles' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('effective')).toHaveTextContent('sales,legal')
  })

  it('selecting a role narrows the effective roles and remembers the choice; All my roles restores the union', () => {
    renderMenu(access(['sales', 'legal']))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Legal' }))
    expect(screen.getByTestId('effective')).toHaveTextContent(/^legal$/)
    expect(screen.getByRole('menuitemradio', { name: 'Legal' })).toHaveAttribute('aria-checked', 'true')
    expect(readStoredRole('multi@amnex.com')).toBe('legal')

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All my roles' }))
    expect(screen.getByTestId('effective')).toHaveTextContent('sales,legal')
    expect(readStoredRole('multi@amnex.com')).toBeNull()
  })

  it('does not claim the server enforces the narrowed view', () => {
    renderMenu(access(['sales', 'legal']))
    const group = screen.getByRole('group', { name: 'Role' })
    expect(within(group).getByText(/server/i)).toHaveTextContent(/actual access is decided by the server/i)
    expect(within(group).queryByText(/blocked|restricted by the server/i)).not.toBeInTheDocument()
  })

  it('starts narrowed when a valid selection was saved, and ignores a stale one', () => {
    localStorage.setItem('goms.activeRole:multi@amnex.com', 'legal')
    renderMenu(access(['sales', 'legal']))
    expect(screen.getByTestId('effective')).toHaveTextContent(/^legal$/)

    cleanup()
    localStorage.setItem('goms.activeRole:multi@amnex.com', 'finance')
    renderMenu(access(['sales', 'legal']))
    expect(screen.getByTestId('effective')).toHaveTextContent('sales,legal')
    expect(readStoredRole('multi@amnex.com')).toBeNull()
  })
})

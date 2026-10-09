import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, within, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AuthStatus } from './AuthStatus'

const { onAuthStateChanged, signOut } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('firebase/auth', () => ({ onAuthStateChanged, signOut }))

function authStateCallback(): (user: { email: string } | null) => void {
  return onAuthStateChanged.mock.calls[0][1]
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search + l.hash}</div>
}

function renderStatus(at = '/') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AuthStatus />
      <Where />
    </MemoryRouter>,
  )
}

function requestSignOut() {
  fireEvent.click(screen.getByRole('button', { name: 'Profile options' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
}

describe('AuthStatus', () => {
  beforeEach(() => {
    onAuthStateChanged.mockReset().mockImplementation((_auth, cb) => { cb(null); return () => {} })
    signOut.mockReset().mockResolvedValue(undefined)
  })

  it('shows Sign in under the blank user profile when signed out', () => {
    renderStatus()
    expect(screen.getByRole('button', { name: 'Profile options' })).toHaveTextContent('User')
    fireEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    expect(screen.getByRole('menuitem', { name: /sign in/i })).toBeInTheDocument()
  })

  it('sends the user to /login, returning to the current page, when "Sign in" is clicked', () => {
    renderStatus('/sales/roster?tab=a#x')
    fireEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /sign in/i }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/login?next=${encodeURIComponent('/sales/roster?tab=a#x')}`,
    )
  })

  it('shows the signed-in account\'s email once Firebase reports a user', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    renderStatus()
    expect(screen.getAllByText('rajas@amnex.com').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
  })

  it('asks for confirmation before signing out, rather than signing out immediately', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    renderStatus()
    requestSignOut()

    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/sign out\?/i)).toBeInTheDocument()
  })

  it('signs out only once the confirm dialog is confirmed', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    renderStatus()
    requestSignOut()

    const dialog = screen.getByRole('dialog')
    await act(async () => {
      within(dialog).getByRole('button', { name: /^sign out$/i }).click()
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('redirects to /login once sign-out completes, leaving the internal page', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    renderStatus('/sales/roster')
    expect(screen.getByTestId('where')).toHaveTextContent('/sales/roster')
    requestSignOut()
    await act(async () => {
      within(screen.getByRole('dialog')).getByRole('button', { name: /^sign out$/i }).click()
    })
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/login$/))
  })

  it('stays put if sign-out fails', async () => {
    signOut.mockRejectedValue(new Error('network'))
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    renderStatus('/sales/roster')
    requestSignOut()
    await act(async () => {
      within(screen.getByRole('dialog')).getByRole('button', { name: /^sign out$/i }).click()
    })
    expect(screen.getByTestId('where')).toHaveTextContent('/sales/roster')
  })

  it('does not sign out if the confirmation is cancelled', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    renderStatus()
    requestSignOut()
    act(() => { screen.getByRole('button', { name: /cancel/i }).click() })

    expect(signOut).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('updates live when Firebase pushes a sign-out', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    renderStatus()
    expect(screen.getAllByText('rajas@amnex.com').length).toBeGreaterThan(0)

    act(() => authStateCallback()(null))

    expect(screen.queryByText('rajas@amnex.com')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Profile options' }))
    expect(screen.getByRole('menuitem', { name: /sign in/i })).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, within, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthStatus } from './AuthStatus'
import * as authPrompt from '@/lib/authPrompt'

const { onAuthStateChanged, signOut } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('firebase/auth', () => ({ onAuthStateChanged, signOut }))

function authStateCallback(): (user: { email: string } | null) => void {
  return onAuthStateChanged.mock.calls[0][1]
}

function renderStatus() {
  return render(<MemoryRouter><AuthStatus /></MemoryRouter>)
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

  it('shows a "Sign in" affordance when signed out', () => {
    renderStatus()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('triggers the shared sign-in prompt when "Sign in" is clicked, rather than its own popup flow', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    renderStatus()
    screen.getByRole('button', { name: /sign in/i }).click()
    expect(spy).toHaveBeenCalledWith('unauthorized')
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
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})

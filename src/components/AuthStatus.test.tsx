import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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

describe('AuthStatus', () => {
  beforeEach(() => {
    onAuthStateChanged.mockReset().mockImplementation((_auth, cb) => { cb(null); return () => {} })
    signOut.mockReset().mockResolvedValue(undefined)
  })

  it('shows a "Sign in" affordance when signed out', () => {
    render(<AuthStatus />)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('triggers the shared sign-in prompt when "Sign in" is clicked, rather than its own popup flow', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    render(<AuthStatus />)
    screen.getByRole('button', { name: /sign in/i }).click()
    expect(spy).toHaveBeenCalledWith('unauthorized')
  })

  it('shows the signed-in account\'s email once Firebase reports a user', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    render(<AuthStatus />)
    expect(screen.getAllByText('rajas@amnex.com').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
  })

  it('signs out when the signed-in state\'s sign-out control is clicked', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    render(<AuthStatus />)
    await act(async () => {
      screen.getByRole('button', { name: /sign out/i }).click()
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('updates live when Firebase pushes a sign-out', () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb({ email: 'rajas@amnex.com' }); return () => {} })
    render(<AuthStatus />)
    expect(screen.getAllByText('rajas@amnex.com').length).toBeGreaterThan(0)

    act(() => authStateCallback()(null))

    expect(screen.queryByText('rajas@amnex.com')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})

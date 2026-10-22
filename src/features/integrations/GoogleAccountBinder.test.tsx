import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@/lib/auth'

const h = vi.hoisted(() => ({
  user: { value: null as AuthUser | null },
  listeners: new Set<() => void>(),
  loadGoogleSettings: vi.fn(),
  disconnectAllDrive: vi.fn(),
}))
// The binder must follow the shared auth facade (Firebase OR direct Google OAuth), never Firebase directly.
vi.mock('@/lib/auth', async () => {
  const { useState, useEffect } = await import('react')
  return {
    useAuthUser: () => {
      const [, bump] = useState(0)
      useEffect(() => { const l = () => bump((n) => n + 1); h.listeners.add(l); return () => { h.listeners.delete(l) } }, [])
      return { user: h.user.value, loading: false }
    },
  }
})
vi.mock('./settings', () => ({ loadGoogleSettings: h.loadGoogleSettings }))
vi.mock('@/features/dms/googleDrive', () => ({ disconnectAllDrive: h.disconnectAllDrive }))
import { GoogleAccountBinder, googleAccountFromAuthUser } from './GoogleAccountBinder'
import { getGoogleAccount, setGoogleAccount } from './session'

const firebaseUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  email: 'Asha@Amnex.com', displayName: 'Asha', photoUrl: null, emailVerified: true, uid: 'fb-uid-1', googleId: '1029384756', ...over,
})
const oauthUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  email: 'asha@amnex.com', displayName: null, photoUrl: null, emailVerified: true, uid: 'g:1029384756', googleId: '1029384756', ...over,
})
const signInAs = (user: AuthUser | null) => act(() => { h.user.value = user; h.listeners.forEach((l) => l()) })
const renderBinder = (client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) =>
  render(<QueryClientProvider client={client}><GoogleAccountBinder /></QueryClientProvider>)

beforeEach(() => { h.user.value = null; h.listeners.clear(); h.loadGoogleSettings.mockReset().mockResolvedValue(undefined); h.disconnectAllDrive.mockReset(); setGoogleAccount(null) })
afterEach(() => { cleanup(); setGoogleAccount(null) })

describe('googleAccountFromAuthUser', () => {
  it.each([
    ['Firebase', firebaseUser(), { uid: 'fb-uid-1', email: 'asha@amnex.com', googleId: '1029384756' }],
    ['direct Google OAuth', oauthUser(), { uid: 'g:1029384756', email: 'asha@amnex.com', googleId: '1029384756' }],
  ])('maps a verified @amnex.com %s identity (email lower-cased)', (_name, user, expected) => {
    expect(googleAccountFromAuthUser(user)).toEqual(expected)
  })

  it.each([
    ['signed out', null],
    ['unverified email', firebaseUser({ emailVerified: false })],
    ['non-Amnex email', oauthUser({ email: 'asha@gmail.com' })],
    ['lookalike domain', oauthUser({ email: 'asha@amnex.com.evil.test' })],
    ['no email', oauthUser({ email: null })],
    ['no uid', oauthUser({ uid: undefined })],
    ['no Google subject id', firebaseUser({ googleId: undefined })],
  ])('refuses %s', (_name, user) => {
    expect(googleAccountFromAuthUser(user)).toBeNull()
  })
})

describe('<GoogleAccountBinder />', () => {
  it('binds the signed-in account and loads its settings (OAuth identity)', () => {
    h.user.value = oauthUser()
    renderBinder()
    const account = { uid: 'g:1029384756', email: 'asha@amnex.com', googleId: '1029384756' }
    expect(getGoogleAccount()).toEqual(account)
    expect(h.loadGoogleSettings).toHaveBeenCalledWith(account)
  })

  it('binds a Firebase identity the same way (transition period)', () => {
    h.user.value = firebaseUser()
    renderBinder()
    expect(getGoogleAccount()).toEqual({ uid: 'fb-uid-1', email: 'asha@amnex.com', googleId: '1029384756' })
  })

  it('with no user (signed out, or a build without a provider) holds no account and drops every Drive token', () => {
    renderBinder()
    expect(getGoogleAccount()).toBeNull()
    expect(h.disconnectAllDrive).toHaveBeenCalled()
    expect(h.loadGoogleSettings).not.toHaveBeenCalled()
  })

  it('drops the account and the Drive tokens on sign-out, and for an ineligible identity', () => {
    h.user.value = oauthUser()
    renderBinder()
    h.disconnectAllDrive.mockClear()
    signInAs(null)
    expect(getGoogleAccount()).toBeNull()
    expect(h.disconnectAllDrive).toHaveBeenCalledTimes(1)
    signInAs(oauthUser())
    h.disconnectAllDrive.mockClear()
    signInAs(oauthUser({ email: 'asha@gmail.com' }))
    expect(getGoogleAccount()).toBeNull()
    expect(h.disconnectAllDrive).toHaveBeenCalledTimes(1)
  })

  it('does NOT drop tokens or reload settings when the session re-emits the same person (an OAuth access-token refresh does this every ~15 minutes)', () => {
    h.user.value = oauthUser()
    renderBinder()
    expect(h.loadGoogleSettings).toHaveBeenCalledTimes(1)
    h.disconnectAllDrive.mockClear()
    signInAs(oauthUser()) // a new object, same identity
    signInAs(oauthUser())
    expect(h.loadGoogleSettings).toHaveBeenCalledTimes(1)
    expect(h.disconnectAllDrive).not.toHaveBeenCalled()
  })

  it('rebinds, and drops the previous person\'s Drive tokens, when a different person signs in', () => {
    h.user.value = oauthUser()
    renderBinder()
    h.disconnectAllDrive.mockClear()
    signInAs(oauthUser({ email: 'ravi@amnex.com', uid: 'g:555', googleId: '555' }))
    expect(getGoogleAccount()).toEqual({ uid: 'g:555', email: 'ravi@amnex.com', googleId: '555' })
    expect(h.disconnectAllDrive).toHaveBeenCalledTimes(1)
    expect(h.loadGoogleSettings).toHaveBeenCalledTimes(2)
  })

  it('removes the previous user data from mounted observers on account changes', async () => {
    // Linked Google accounts can change while the API uid remains unchanged.
    const previous = { uid: 'signed', email: 'asha@amnex.com', googleId: 'previous-google-account' }
    setGoogleAccount(previous)
    h.user.value = oauthUser({ uid: previous.uid, googleId: previous.googleId })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['private'], 'old user private data')
    function Viewer() { const { data } = useQuery({ queryKey: ['private'], queryFn: async () => null, enabled: false }); return <span>{data ? String(data) : 'No private data'}</span> }
    render(<QueryClientProvider client={client}><GoogleAccountBinder /><Viewer /></QueryClientProvider>)
    expect(screen.getByText('old user private data')).toBeInTheDocument() // the same person was already bound: nothing is dropped
    signInAs(oauthUser({ uid: 'signed', googleId: 'another-google-account' }))
    await waitFor(() => expect(screen.queryByText('old user private data')).not.toBeInTheDocument())
    expect(client.getQueryData(['private'])).toBeUndefined()
  })

  it('keeps cached data when the same person is re-emitted', async () => {
    h.user.value = oauthUser()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderBinder(client)
    client.setQueryData(['private'], 'still mine')
    signInAs(oauthUser())
    expect(client.getQueryData(['private'])).toBe('still mine')
  })

  it('a failing settings load never throws into the app', async () => {
    h.loadGoogleSettings.mockRejectedValue(new Error('network'))
    h.user.value = oauthUser()
    expect(() => renderBinder()).not.toThrow()
    await Promise.resolve()
  })
})

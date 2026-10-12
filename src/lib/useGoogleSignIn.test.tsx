import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGoogleSignIn, isAmnexAccount } from './useGoogleSignIn'

const fb = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('firebase/auth', () => fb)
vi.mock('@/lib/firebaseAuth', () => ({ auth: {}, googleProvider: {} }))

describe('useGoogleSignIn', () => {
  beforeEach(() => {
    fb.onAuthStateChanged.mockReset().mockImplementation(() => () => {})
    fb.signInWithPopup.mockReset().mockResolvedValue({})
    fb.signOut.mockReset().mockResolvedValue(undefined)
  })

  it('is unresolved until Firebase reports the persisted session, then exposes the user', () => {
    let cb: (u: unknown) => void = () => {}
    fb.onAuthStateChanged.mockImplementation((_a, c) => { cb = c; return () => {} })
    const { result } = renderHook(() => useGoogleSignIn())
    expect(result.current.resolved).toBe(false)
    act(() => cb({ email: 'a@amnex.com', emailVerified: true, displayName: 'Asha', photoURL: null }))
    expect(result.current.resolved).toBe(true)
    // The hook exposes the provider-neutral facade user, not the raw Firebase User.
    expect(result.current.user).toEqual({ email: 'a@amnex.com', displayName: 'Asha', photoUrl: null, emailVerified: true })
  })

  it('goes signing-in then back to idle on success', async () => {
    let finish: () => void = () => {}
    fb.signInWithPopup.mockReturnValue(new Promise<void>((r) => { finish = r }))
    const { result } = renderHook(() => useGoogleSignIn())
    act(() => result.current.signIn())
    expect(result.current.status).toBe('signing-in')
    await act(async () => { finish() })
    expect(result.current.status).toBe('idle')
  })

  it('reports an error for a real failure', async () => {
    fb.signInWithPopup.mockRejectedValue({ code: 'auth/network-request-failed' })
    const { result } = renderHook(() => useGoogleSignIn())
    act(() => result.current.signIn())
    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])('stays quiet when the popup is dismissed (%s)', async (code) => {
    fb.signInWithPopup.mockRejectedValue({ code })
    const { result } = renderHook(() => useGoogleSignIn())
    act(() => result.current.signIn())
    await waitFor(() => expect(fb.signInWithPopup).toHaveBeenCalled())
    await waitFor(() => expect(result.current.status).toBe('idle'))
  })

  it('switchAccount signs out', async () => {
    const { result } = renderHook(() => useGoogleSignIn())
    await act(async () => { await result.current.switchAccount() })
    expect(fb.signOut).toHaveBeenCalledTimes(1)
  })
})

describe('isAmnexAccount', () => {
  it('requires a verified @amnex.com address (case-insensitive)', () => {
    expect(isAmnexAccount({ email: 'A@Amnex.com', emailVerified: true })).toBe(true)
    expect(isAmnexAccount({ email: 'a@amnex.com', emailVerified: false })).toBe(false)
    expect(isAmnexAccount({ email: 'a@amnex.com.evil.io', emailVerified: true })).toBe(false)
    expect(isAmnexAccount({ email: null, emailVerified: true })).toBe(false)
  })
})

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@/lib/auth'

const h = vi.hoisted(() => ({
  configured: { value: true },
  subscribe: vi.fn(),
}))
// useSignedIn must follow the shared auth facade (Firebase OR direct Google OAuth), never Firebase directly. The facade's real hook runs on top of this fake provider.
vi.mock('@/lib/auth/authApi', () => ({
  AUTH_KIND: 'oauth',
  authApi: { get configured() { return h.configured.value }, subscribe: (...a: unknown[]) => h.subscribe(...a) },
}))
import { useSignedIn } from './useSignedIn'

type Listener = (user: AuthUser | null, loading: boolean) => void
const listener = (): Listener => h.subscribe.mock.calls[0][0]
const user = (over: Partial<AuthUser> = {}): AuthUser => ({ email: 'rajas@amnex.com', displayName: null, photoUrl: null, emailVerified: true, ...over })

describe('useSignedIn', () => {
  beforeEach(() => {
    h.configured.value = true
    h.subscribe.mockReset().mockImplementation(() => () => {})
  })

  it('is false until the provider reports a user, true while one is signed in, and false again after sign-out', () => {
    const { result } = renderHook(() => useSignedIn())
    expect(result.current).toBe(false)
    act(() => listener()(user(), false))
    expect(result.current).toBe(true)
    act(() => listener()(null, false))
    expect(result.current).toBe(false)
  })

  it('works for a direct Google OAuth identity (no Firebase involved)', () => {
    const { result } = renderHook(() => useSignedIn())
    act(() => listener()(user({ uid: 'g:1029384756', googleId: '1029384756' }), false))
    expect(result.current).toBe(true)
  })

  it('stays false while the provider is still working out whether anyone is signed in', () => {
    const { result } = renderHook(() => useSignedIn())
    act(() => listener()(null, true))
    expect(result.current).toBe(false)
  })

  it('is false when the build has no usable provider (it reports signed out)', () => {
    h.configured.value = false
    h.subscribe.mockImplementation((cb: Listener) => { cb(null, false); return () => {} })
    const { result } = renderHook(() => useSignedIn())
    expect(result.current).toBe(false)
  })

  it('stops listening when the component unmounts', () => {
    const unsubscribe = vi.fn()
    h.subscribe.mockImplementation(() => unsubscribe)
    const { unmount } = renderHook(() => useSignedIn())
    expect(unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

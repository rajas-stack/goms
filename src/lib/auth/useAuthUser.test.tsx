import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { api } = vi.hoisted(() => ({ api: { cb: null as null | ((u: unknown, l: boolean) => void), configured: true } }))
vi.mock('./authApi', () => ({
  authApi: { get configured() { return api.configured }, subscribe: (cb: (u: unknown, l: boolean) => void) => { api.cb = cb; return () => { api.cb = null } } },
}))
import { useAuthUser } from './useAuthUser'

describe('useAuthUser', () => {
  it('starts loading when configured, then follows the provider', () => {
    api.configured = true
    const { result, unmount } = renderHook(() => useAuthUser())
    expect(result.current).toEqual({ user: null, loading: true })
    act(() => api.cb!({ email: 'a@amnex.com', displayName: null, photoUrl: null, emailVerified: true }, false))
    expect(result.current).toEqual({ user: { email: 'a@amnex.com', displayName: null, photoUrl: null, emailVerified: true }, loading: false })
    unmount(); expect(api.cb).toBeNull()
  })
  it('is not loading when sign-in is not configured', () => {
    api.configured = false
    expect(renderHook(() => useAuthUser()).result.current).toEqual({ user: null, loading: false })
  })
})

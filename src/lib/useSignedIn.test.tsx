import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { onAuthStateChanged, authValue } = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  authValue: { value: {} as object | null },
}))
vi.mock('firebase/auth', () => ({ onAuthStateChanged }))
vi.mock('@/lib/firebaseAuth', () => ({ get auth() { return authValue.value } }))
import { useSignedIn } from './useSignedIn'

/** The listener the hook handed to Firebase, so a test can play "a user signed in / out". */
const listener = (): ((user: { email: string } | null) => void) => onAuthStateChanged.mock.calls[0][1]

describe('useSignedIn', () => {
  beforeEach(() => {
    authValue.value = {}
    onAuthStateChanged.mockReset().mockImplementation(() => () => {})
  })

  it('is false until Firebase reports a user, true while one is signed in, and false again after sign-out', () => {
    const { result } = renderHook(() => useSignedIn())
    expect(result.current).toBe(false)
    act(() => listener()({ email: 'rajas@amnex.com' }))
    expect(result.current).toBe(true)
    act(() => listener()(null))
    expect(result.current).toBe(false)
  })

  it('is false, and subscribes to nothing, when Firebase is not configured for this build', () => {
    authValue.value = null
    const { result } = renderHook(() => useSignedIn())
    expect(result.current).toBe(false)
    expect(onAuthStateChanged).not.toHaveBeenCalled()
  })

  it('stops listening when the component unmounts', () => {
    const unsubscribe = vi.fn()
    onAuthStateChanged.mockImplementation(() => unsubscribe)
    const { unmount } = renderHook(() => useSignedIn())
    expect(unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

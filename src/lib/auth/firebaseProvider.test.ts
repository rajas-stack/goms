import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fb } = vi.hoisted(() => ({ fb: { auth: null as null | { currentUser: null | { getIdToken: () => Promise<string> } }, listeners: [] as ((u: unknown) => void)[], signIn: vi.fn(), signOut: vi.fn() } }))
vi.mock('@/lib/firebaseAuth', () => ({ get auth() { return fb.auth }, googleProvider: { id: 'google' } }))
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => { fb.listeners.push(cb); return () => {} },
  signInWithPopup: (...a: unknown[]) => fb.signIn(...a),
  signOut: (...a: unknown[]) => fb.signOut(...a),
}))
import { firebaseProvider } from './firebaseProvider'

beforeEach(() => { fb.auth = { currentUser: null }; fb.listeners.length = 0; fb.signIn.mockReset(); fb.signOut.mockReset() })

describe('firebaseProvider (must behave exactly like the pre-facade code)', () => {
  it('is configured only when Firebase is', () => {
    expect(firebaseProvider.configured).toBe(true)
    fb.auth = null
    expect(firebaseProvider.configured).toBe(false)
  })
  it('maps a Firebase user and reports loading=false once Firebase answers', () => {
    const seen: unknown[] = []
    firebaseProvider.subscribe((u, loading) => seen.push([u, loading]))
    fb.listeners[0]({ email: 'a@amnex.com', displayName: 'Asha', photoURL: 'p.png', emailVerified: true })
    fb.listeners[0](null)
    expect(seen).toEqual([[{ email: 'a@amnex.com', displayName: 'Asha', photoUrl: 'p.png', emailVerified: true }, false], [null, false]])
  })
  it('with no Firebase config: immediately signed-out and not loading (never throws)', () => {
    fb.auth = null
    const seen: unknown[] = []
    firebaseProvider.subscribe((u, l) => seen.push([u, l]))
    expect(seen).toEqual([[null, false]])
  })
  it('signIn opens the Google popup; signOut signs out; both are no-ops without Firebase', async () => {
    await firebaseProvider.signIn(); expect(fb.signIn).toHaveBeenCalledWith(fb.auth, { id: 'google' })
    await firebaseProvider.signOut(); expect(fb.signOut).toHaveBeenCalledWith(fb.auth)
    fb.auth = null; fb.signIn.mockReset()
    await firebaseProvider.signIn(); expect(fb.signIn).not.toHaveBeenCalled()
  })
  it('authorization headers: Bearer <Firebase ID token>, or {} when signed out / refresh fails / unconfigured', async () => {
    await expect(firebaseProvider.getAuthorizationHeaders()).resolves.toEqual({})
    fb.auth = { currentUser: { getIdToken: async () => 'id-tok' } }
    await expect(firebaseProvider.getAuthorizationHeaders()).resolves.toEqual({ Authorization: 'Bearer id-tok' })
    fb.auth = { currentUser: { getIdToken: async () => { throw new Error('revoked') } } }
    await expect(firebaseProvider.getAuthorizationHeaders()).resolves.toEqual({})
    fb.auth = null
    await expect(firebaseProvider.getAuthorizationHeaders()).resolves.toEqual({})
  })
})

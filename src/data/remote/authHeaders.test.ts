import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAuthHeaders } from './authHeaders'

const { currentUser, authValue } = vi.hoisted(() => ({
  currentUser: { value: null as null | { getIdToken: () => Promise<string> } },
  // Firebase's own `auth` export is `Auth | null` — null when
  // VITE_FIREBASE_* config is absent (see firebaseAuth.ts). Defaults to a
  // configured stand-in; the null-auth test below overrides it directly.
  authValue: { value: true as boolean },
}))
vi.mock('@/lib/firebaseAuth', () => ({
  get auth() { return authValue.value ? { currentUser: currentUser.value } : null },
}))

describe('getAuthHeaders', () => {
  beforeEach(() => { currentUser.value = null; authValue.value = true })

  it('returns no Authorization header when signed out', async () => {
    await expect(getAuthHeaders()).resolves.toEqual({})
  })

  it('returns a Bearer header with the current ID token when signed in', async () => {
    currentUser.value = { getIdToken: async () => 'fake-id-token' }
    await expect(getAuthHeaders()).resolves.toEqual({ Authorization: 'Bearer fake-id-token' })
  })

  it('returns no header if token refresh fails (expired/revoked session)', async () => {
    currentUser.value = { getIdToken: async () => { throw new Error('token refresh failed') } }
    await expect(getAuthHeaders()).resolves.toEqual({})
  })

  it('returns no header (and does not throw) when Firebase is unconfigured (auth === null)', async () => {
    authValue.value = false
    await expect(getAuthHeaders()).resolves.toEqual({})
  })
})

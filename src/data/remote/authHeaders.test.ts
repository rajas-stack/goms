import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAuthHeaders } from './authHeaders'

const { currentUser } = vi.hoisted(() => ({ currentUser: { value: null as null | { getIdToken: () => Promise<string> } } }))
vi.mock('@/lib/firebaseAuth', () => ({ get auth() { return { currentUser: currentUser.value } } }))

describe('getAuthHeaders', () => {
  beforeEach(() => { currentUser.value = null })

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
})

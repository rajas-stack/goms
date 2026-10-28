import { describe, expect, it, vi } from 'vitest'

describe('auth provider selection', () => {
  it('defaults to the Firebase provider and does not call bootstrap of the OAuth one', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', ''); vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', '')
    const mod = await import('./authApi')
    expect(mod.AUTH_KIND).toBe('firebase'); expect(mod.authApi.kind).toBe('firebase')
  })
  it('selects the OAuth provider only for VITE_AUTH_PROVIDER=oauth', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', 'oauth'); vi.stubEnv('VITE_API_BASE_URL', 'https://goms.test')
    const mod = await import('./authApi')
    expect(mod.authApi.kind).toBe('oauth')
  })
  it('falls back to Firebase for an unknown value', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', 'okta'); vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', '')
    const mod = await import('./authApi')
    expect(mod.AUTH_KIND).toBe('firebase'); expect(mod.authApi.kind).toBe('firebase')
  })
  it('offers the optional browser Google sign-in when Firebase is not configured but a Google client ID is (local mode)', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', ''); vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', 'client.apps.googleusercontent.com')
    const mod = await import('./authApi')
    expect(mod.authApi.kind).toBe('google-local')
    expect(mod.authApi.configured).toBe(false) // optional: nothing is forced through /login
  })
})

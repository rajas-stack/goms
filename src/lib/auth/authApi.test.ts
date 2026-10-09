import { describe, expect, it, vi } from 'vitest'

describe('auth provider selection', () => {
  it('defaults to the Firebase provider and does not call bootstrap of the OAuth one', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', '')
    const mod = await import('./authApi')
    expect(mod.AUTH_KIND).toBe('firebase'); expect(mod.authApi.kind).toBe('firebase')
  })
  it('selects the OAuth provider only for VITE_AUTH_PROVIDER=oauth', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', 'oauth'); vi.stubEnv('VITE_API_BASE_URL', 'https://goms.test')
    const mod = await import('./authApi')
    expect(mod.authApi.kind).toBe('oauth')
  })
  it('falls back to Firebase for an unknown value', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', 'okta')
    const mod = await import('./authApi')
    expect(mod.AUTH_KIND).toBe('firebase'); expect(mod.authApi.kind).toBe('firebase')
  })
})

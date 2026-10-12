// src/lib/auth/stores.ts
import { ShellUpdateRequiredError } from './errors'
import type { TokenStore } from './session'

/** Web refresh-token storage. The access token is never stored. Blocked storage degrades to "signed out", never to a crash. */
export function createLocalStorageStore(key = 'goms.auth.refresh'): TokenStore {
  return {
    async get() { try { return localStorage.getItem(key) } catch { return null } },
    async set(token) {
      try { localStorage.setItem(key, token) } catch {
        // Blocked or full. The caller already holds the NEW session in memory (this page stays signed in), but the server has rotated away from
        // whatever is still stored. Leaving that would replay a dead token on the next load, which the server treats as reuse and answers by
        // revoking the whole session family. Drop it, so the next load simply starts signed out.
        try { localStorage.removeItem(key) } catch { /* storage is entirely blocked: nothing stale can be there to replay */ }
      }
    },
    async clear() { try { localStorage.removeItem(key) } catch { /* nothing to clear */ } },
  }
}

/** Android: the platform keystore. Each call loads `./native` on demand, so the web bundle and node tests never import the plugins eagerly. */
export function createNativeStore(): TokenStore {
  const real = () => import('./native').then((m) => m.createSecureTokenStore())
  return { get: async () => (await real()).get(), set: async (t) => (await real()).set(t), clear: async () => (await real()).clear() }
}

/** An old shell without secure storage: refuse to hold a token at all. Never localStorage. */
export function createShellUpdateRequiredStore(): TokenStore {
  return { async get() { return null }, async set() { throw new ShellUpdateRequiredError() }, async clear() {} }
}

export function selectTokenStore(o: { inShell: boolean; secureStorage: boolean }): TokenStore {
  if (!o.inShell) return createLocalStorageStore()
  return o.secureStorage ? createNativeStore() : createShellUpdateRequiredStore()
}

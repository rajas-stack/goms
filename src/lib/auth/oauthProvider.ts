import { hasCapability, isGomsShell, shellScheme } from '@/lib/nativeShell'
import { bootstrapAuth, bootstrapNativeAuth, HANDOFF_PARAMS } from './bootstrap'
import { ShellUpdateRequiredError } from './errors'
import { createAuthFetch } from './authFetch'
import { createSession, type LockManagerLike } from './session'
import { selectTokenStore } from './stores'
import type { AuthProviderApi } from './types'

const apiBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')
/** True only inside the GOMS Android shell (user-agent token set by native code), never merely "some Capacitor webview". */
export const inShell = isGomsShell()

export const session = createSession({
  apiBase,
  fetchFn: (...args) => fetch(...args),
  store: selectTokenStore({ inShell, secureStorage: hasCapability('secureStorage') }),
  locks: typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator.locks as unknown as LockManagerLike) : null,
  now: () => Date.now(),
})

export function webSignInUrl(): string {
  // The one-time handoff params must never ride along into the next sign-in (the bootstrap strips them first; this is the backstop).
  const params = new URLSearchParams(window.location.search)
  for (const name of HANDOFF_PARAMS) params.delete(name)
  const query = params.toString()
  const returnTo = `${window.location.pathname}${query ? `?${query}` : ''}`
  return `${apiBase}/api/oauth/google/start?client=web&return_to=${encodeURIComponent(returnTo)}`
}

export const oauthProvider: AuthProviderApi = {
  kind: 'oauth',
  get configured() { return apiBase !== '' },
  subscribe: (cb) => session.subscribe((u, loading) => cb(u ? { email: u.email, displayName: null, photoUrl: null, emailVerified: true } : null, loading)),
  async signIn() {
    // Decided BEFORE any navigation. Google rejects embedded WebViews, so the shell must never take the full-page web redirect.
    if (!inShell) { window.location.assign(webSignInUrl()); return }
    // Inside the shell a missing native piece means an old APK: refuse (no degraded token storage) and ask for an update.
    if (!(hasCapability('browser') && hasCapability('appLinks') && hasCapability('secureStorage'))) throw new ShellUpdateRequiredError()
    await (await import('./native')).openNativeSignIn()
  },
  signOut: () => session.signOut(),
  async getAuthorizationHeaders(): Promise<Record<string, string>> {
    const token = await session.getAccessToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  },
  fetch: createAuthFetch(session),
  bootstrap: () => {
    if (!inShell) return bootstrapAuth(session, window)
    const scheme = shellScheme()
    // An old shell, or one that reports no scheme, cannot receive a deep link: stay signed out (init() still clears `loading` so the
    // auth gate renders; the secure-storage-less store never reads or writes a token); signIn() tells the user to update.
    if (!scheme || !hasCapability('appLinks') || !hasCapability('secureStorage')) return session.init()
    return bootstrapNativeAuth(session, scheme)
  },
}

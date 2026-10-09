// src/lib/auth/native.ts
// Loaded ONLY on demand (dynamic import from bootstrap.ts / stores.ts / oauthProvider.ts) and only inside the GOMS Android shell, so a
// plain browser never downloads the Capacitor plugins.
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { hasCapability } from '@/lib/nativeShell'
import { ShellUpdateRequiredError } from './errors'
import type { TokenStore } from './session'

const CODE_FORMAT = /^[A-Za-z0-9_-]{43}$/
const ERROR_REASONS = new Set(['state', 'domain', 'unverified', 'google', 'denied'])

/** Accepts ONLY `<scheme>://auth?<query>` for this app's own scheme, carrying exactly one `code` (43 base64url chars) or exactly one known
 *  `error`. Anything else — another flavor's scheme, extra/repeated parameters, a fragment, userinfo, a port, a path, a percent-encoded
 *  value — is ignored.
 *
 *  The link is matched by its exact RAW prefix, never through `new URL`: WebViews before Chromium M130 parse a custom-scheme URL with host ''
 *  and pathname '//auth' (current ones: host 'auth'), so any host/pathname check rejects every link on those and sign-in silently does nothing.
 *  Matching is case-sensitive on purpose (the manifest declares a lower-case scheme and host). */
export function parseAuthDeepLink(url: string, scheme: string | null): { code?: string; error?: string } | null {
  if (!scheme || typeof url !== 'string') return null
  const prefix = `${scheme}://auth?`
  if (!url.startsWith(prefix)) return null
  const query = url.slice(prefix.length)
  const params = new URLSearchParams(query)
  const keys = [...params.keys()]
  if (keys.length !== 1) return null
  const key = keys[0]
  const values = params.getAll(key)
  if (values.length !== 1) return null
  // The raw query must be EXACTLY `key=value`: URLSearchParams would otherwise decode %41 to "A" (a smuggled code), and ignore a stray `&`.
  if (query !== `${key}=${values[0]}`) return null
  if (key === 'code' && CODE_FORMAT.test(values[0])) return { code: values[0] }
  if (key === 'error' && ERROR_REASONS.has(values[0])) return { error: values[0] }
  return null
}

/** The sign-in URL is built from the page's own origin — the WebView can only ever be on the pinned origin — never from a value the
 *  page was handed. */
export async function openNativeSignIn(origin: string = window.location.origin): Promise<void> {
  const url = new URL('/api/oauth/google/start', origin)
  url.searchParams.set('client', 'app')
  if (url.origin !== window.location.origin) throw new Error('Unexpected sign-in origin')
  await Browser.open({ url: url.toString() })
}

type LinkHandler = (r: { code?: string; error?: string }) => Promise<void>

/** Registers once at startup. Handles links delivered while the app runs (`handler`) AND the link that launched the app (`launchHandler`,
 *  defaulting to `handler`). They are separate because Capacitor NEVER clears the launch URL: every WebView reload in that Activity re-delivers
 *  the original (by then spent) link, so a failure of the launch link means something different from a failure of a fresh one. The code is
 *  never logged. */
export async function listenForAuthDeepLinks(scheme: string, handler: LinkHandler, launchHandler: LinkHandler = handler): Promise<void> {
  // A code is one-time: if the launch link is also re-delivered as a warm link, the second redeem would only fail and raise a false prompt.
  // Only code links are deduped - an identical ?error link delivered again is a new failed attempt and must be shown again.
  const seen = new Set<string>()
  const handle = async (url: string, onLink: LinkHandler) => {
    const parsed = parseAuthDeepLink(url, scheme)
    if (!parsed) return
    if (parsed.code !== undefined) {
      if (seen.has(url)) return
      seen.add(url)
    }
    try { await Browser.close() } catch { /* already closed (Android Custom Tabs cannot be closed programmatically) */ }
    try { await onLink(parsed) } catch { console.error('Sign-in could not be completed.') }
  }
  await App.addListener('appUrlOpen', (e) => { void handle(e.url, handler) })
  const launch = await App.getLaunchUrl()
  if (launch?.url) await handle(launch.url, launchHandler)
}

/** The refresh token lives in the platform keystore (Android Keystore-backed), never in WebView localStorage.
 *
 *  What keeps it out of localStorage is the decision made BEFORE this module is imported: `selectTokenStore` only creates this store when the
 *  shell reports secure storage (`hasCapability`), and `oauthProvider.signIn` refuses without it. The plugin itself registers a WEB
 *  implementation (which writes to localStorage) as soon as it is imported, so `Capacitor.isPluginAvailable` is true afterwards even without the
 *  native half - the per-call check below therefore does NOT prove the native plugin is present. It only re-evaluates the same capability gate
 *  on every operation, so a store that was created under a different answer fails closed instead of reading or writing. */
export function createSecureTokenStore(key = 'goms.auth.refresh'): TokenStore {
  const native = () => hasCapability('secureStorage')
  return {
    async get() {
      if (!native()) return null
      try { const v = await SecureStorage.get(key, false); return typeof v === 'string' ? v : null } catch { return null }
    },
    async set(token) {
      if (!native()) throw new ShellUpdateRequiredError()
      await SecureStorage.set(key, token)
    },
    async clear() {
      if (!native()) return
      try { await SecureStorage.remove(key) } catch { /* nothing stored */ }
    },
  }
}

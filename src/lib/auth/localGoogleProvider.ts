import { loadGoogleIdentity } from '@/features/dms/googleDrive'
import type { AuthProviderApi, AuthUser } from './types'

type Listener = (user: AuthUser | null, loading: boolean) => void

const STORE = 'goms.localGoogleUser'
const listeners = new Set<Listener>()
let current: AuthUser | null = (() => { try { return JSON.parse(localStorage.getItem(STORE) ?? 'null') as AuthUser | null } catch { return null } })()

function setUser(next: AuthUser | null) {
  current = next
  try { if (next) localStorage.setItem(STORE, JSON.stringify(next)); else localStorage.removeItem(STORE) } catch { /* private window: this tab still knows */ }
  listeners.forEach((listener) => listener(current, false))
}

/** Sign-in for builds without Firebase (local mode on 5173): Google's account popup on the same page, then the Google profile
 *  (name, email, photo) is who is using GOMS in this browser. Optional: nothing requires it (`configured` stays false).
 *  shortcut: no server checks this identity, so it grants nothing beyond this browser's local data; use the server sign-in once
 *  GOMS runs on its API. */
export const localGoogleProvider: AuthProviderApi = {
  kind: 'google-local',
  configured: false,
  subscribe(cb) {
    listeners.add(cb)
    cb(current, false)
    return () => { listeners.delete(cb) }
  },
  signIn: () => new Promise<void>((resolve, reject) => {
    const google = (window as Window & { google?: Awaited<ReturnType<typeof loadGoogleIdentity>> }).google
    // The popup must open inside the click; if Google's script is not loaded yet, load it and ask for one more click.
    if (!google) { loadGoogleIdentity().then(() => reject(new Error('Google sign-in is ready now. Press Continue again.')), reject); return }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? '',
      scope: 'openid email profile',
      error_callback: (error) => reject(new Error(error.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Allow the Google sign-in popup for this site and try again.')),
      callback: (response) => {
        if (response.error || !response.access_token) { reject(new Error(response.error_description ?? 'Google did not sign you in.')); return }
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${response.access_token}` } })
          .then(async (res) => {
            if (!res.ok) throw new Error(`Google did not return your profile (HTTP ${res.status}).`)
            const info = await res.json() as { email?: string; name?: string; picture?: string; email_verified?: boolean }
            setUser({ email: info.email ?? null, displayName: info.name ?? null, photoUrl: info.picture ?? null, emailVerified: !!info.email_verified })
            resolve()
          })
          .catch(reject)
      },
    })
    client.requestAccessToken({ prompt: 'select_account' })
  }),
  async signOut() { setUser(null) },
  async getAuthorizationHeaders() { return {} },
  fetch: (...args) => fetch(...args),
  // Load Google's script early so the first click can open the popup straight away.
  async bootstrap() { void loadGoogleIdentity().catch(() => undefined) },
}

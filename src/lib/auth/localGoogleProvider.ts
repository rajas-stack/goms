import { loadGoogleIdentity } from '@/features/dms/googleDrive'
import { saveGoogleSession, setGoogleAccount, type GoogleAccount } from '@/features/integrations/session'
import type { AuthProviderApi, AuthUser } from './types'

type Listener = (user: AuthUser | null, loading: boolean) => void
/** The stored user also keeps Google's account id (`sub`), so Google apps can be bound to this sign-in. */
type StoredUser = AuthUser & { googleId?: string }

const scope = (name: string) => `https://www.googleapis.com/auth/${name}`
/** Asked once at sign-in so Drive (DMS, reimbursement bills), Calendar and Tasks work without a second account picker.
 *  Keep is left out: its API needs Workspace admin setup, and an unusable scope would fail the whole sign-in. */
const APP_SCOPES = [scope('drive'), scope('calendar.calendarlist.readonly'), scope('calendar.events.readonly'), scope('tasks.readonly')]

const STORE = 'goms.localGoogleUser'
/** The account last signed in here. Kept after sign-out so Google can skip its account chooser next time. */
const LAST_EMAIL = 'goms.lastGoogleEmail'
const lastEmail = () => { try { return localStorage.getItem(LAST_EMAIL) ?? '' } catch { return '' } }
const listeners = new Set<Listener>()
let current: StoredUser | null = (() => { try { return JSON.parse(localStorage.getItem(STORE) ?? 'null') as StoredUser | null } catch { return null } })()

/** The Amnex Google account behind this sign-in, for the Google integrations (null for other accounts or older sign-ins). */
export function localGoogleAccount(): GoogleAccount | null {
  const email = current?.email?.toLowerCase()
  return current?.googleId && current.emailVerified && email?.endsWith('@amnex.com') ? { uid: current.googleId, email, googleId: current.googleId } : null
}

function setUser(next: StoredUser | null) {
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
      scope: ['openid', 'email', 'profile', ...APP_SCOPES].join(' '),
      include_granted_scopes: true,
      // Naming the expected Amnex account lets Google sign straight in (consent shows only the first time).
      hd: 'amnex.com',
      ...(lastEmail() ? { login_hint: lastEmail() } : {}),
      error_callback: (error) => reject(new Error(error.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Allow the Google sign-in popup for this site and try again.')),
      callback: (response) => {
        if (response.error || !response.access_token) { reject(new Error(response.error_description ?? 'Google did not sign you in.')); return }
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${response.access_token}` } })
          .then(async (res) => {
            if (!res.ok) throw new Error(`Google did not return your profile (HTTP ${res.status}).`)
            const info = await res.json() as { sub?: string; email?: string; name?: string; picture?: string; email_verified?: boolean }
            try { if (info.email) localStorage.setItem(LAST_EMAIL, info.email.toLowerCase()) } catch { /* private window */ }
            setUser({ email: info.email ?? null, displayName: info.name ?? null, photoUrl: info.picture ?? null, emailVerified: !!info.email_verified, googleId: info.sub })
            // Hand the same token to the Google apps, so Drive and Calendar reuse this sign-in instead of asking again.
            const account = localGoogleAccount()
            if (account) {
              setGoogleAccount(account)
              saveGoogleSession({ uid: account.uid, email: account.email, accessToken: response.access_token!, scopes: (response.scope ?? '').split(' '),
                expiresAt: Date.now() + Math.min(response.expires_in ?? 3600, 3600) * 1000, clientId: import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? '' })
            }
            resolve()
          })
          .catch(reject)
      },
    })
    client.requestAccessToken({ prompt: lastEmail() ? '' : 'select_account' })
  }),
  async signOut() { setUser(null) },
  async getAuthorizationHeaders() { return {} },
  fetch: (...args) => fetch(...args),
  // Load Google's script early so the first click can open the popup straight away.
  async bootstrap() { void loadGoogleIdentity().catch(() => undefined) },
}

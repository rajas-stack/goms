import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebaseAuth'
import type { AuthProviderApi, AuthUser } from './types'

const toUser = (u: User): AuthUser => ({ email: u.email, displayName: u.displayName, photoUrl: u.photoURL, emailVerified: u.emailVerified })

/** The existing Firebase behaviour, unchanged, behind the facade. */
export const firebaseProvider: AuthProviderApi = {
  kind: 'firebase',
  get configured() { return Boolean(auth) },
  subscribe(cb) {
    if (!auth) { cb(null, false); return () => {} }
    return onAuthStateChanged(auth, (u) => cb(u ? toUser(u) : null, false))
  },
  async signIn() { if (auth) await signInWithPopup(auth, googleProvider) },
  async signOut() { if (auth) await signOut(auth) },
  // getIdToken() transparently refreshes a token that is about to expire; if the user is signed out or the refresh fails
  // the request simply goes out unauthenticated and the server's 401/403 triggers the sign-in prompt.
  async getAuthorizationHeaders(): Promise<Record<string, string>> {
    try {
      const token = await auth?.currentUser?.getIdToken()
      return token ? { Authorization: `Bearer ${token}` } : {}
    } catch {
      return {}
    }
  },
  fetch: (...args) => globalThis.fetch(...args),
  async bootstrap() {},
}

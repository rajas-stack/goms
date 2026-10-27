export interface AuthUser {
  email: string | null
  displayName: string | null
  photoUrl: string | null
  /** Display-only hint for the sign-in screen. The API re-verifies identity on every request and stays the authority. */
  emailVerified: boolean
}

/** What the rest of the app may know about "who is signed in". Firebase and the GOMS OAuth session both implement it,
 *  and `VITE_AUTH_PROVIDER` picks one at build time. */
export interface AuthProviderApi {
  /** 'google-local': optional browser-only Google sign-in for builds without Firebase (localGoogleProvider). */
  readonly kind: 'firebase' | 'oauth' | 'google-local'
  /** False when this build cannot sign anyone in (no Firebase config / no API base URL). */
  readonly configured: boolean
  /** `loading` is true until the provider knows whether anyone is signed in. Returns an unsubscribe function. */
  subscribe(cb: (user: AuthUser | null, loading: boolean) => void): () => void
  signIn(): Promise<void>
  signOut(): Promise<void>
  getAuthorizationHeaders(): Promise<Record<string, string>>
  /** The `fetch` the tRPC links use (the OAuth provider adds one refresh-and-retry on a 401). */
  fetch: typeof fetch
  /** Runs once at startup, before the first render needs identity. */
  bootstrap(): Promise<void>
}

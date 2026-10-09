import { useCallback, useState } from 'react'
import { authApi, useAuthUser, type AuthUser } from '@/lib/auth'

export type GoogleSignInStatus = 'idle' | 'signing-in' | 'error'

// The user closing the popup (or a second click superseding the first) is a
// choice, not a failure — no error line for those. Firebase-provider only: the
// OAuth provider redirects the whole page, so there is no popup to dismiss
// (a Google-side cancel comes back as `auth_error` and is shown by
// AuthPromptDialog).
const QUIET_POPUP_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])

/** Mirrors the server's rule (apps/api/src/auth/identity.ts): a verified
 *  @amnex.com address. Display-only here — the API stays the authority. */
export function isAmnexAccount(user: Pick<AuthUser, 'email' | 'emailVerified'>): boolean {
  return Boolean(user.emailVerified && user.email?.toLowerCase().endsWith('@amnex.com'))
}

/** The one place the login page touches the identity provider: it goes through
 *  the `src/lib/auth` facade, so Firebase (popup) and the GOMS Google OAuth
 *  flow (redirect) are interchangeable here and the page never changes. */
export function useGoogleSignIn() {
  const { user, loading } = useAuthUser()
  const [status, setStatus] = useState<GoogleSignInStatus>('idle')

  const signIn = useCallback(() => {
    if (!authApi.configured) return
    setStatus('signing-in')
    authApi.signIn().then(
      () => setStatus('idle'),
      (err: { code?: string }) => setStatus(err?.code && QUIET_POPUP_CODES.has(err.code) ? 'idle' : 'error'),
    )
  }, [])

  const switchAccount = useCallback(() => authApi.signOut(), [])

  return { configured: authApi.configured, user, resolved: !loading, status, signIn, switchAccount }
}

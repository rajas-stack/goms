import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthUser, type AuthUser } from '@/lib/auth'
import { disconnectAllDrive } from '@/features/dms/googleDrive'
import { getGoogleAccount, setGoogleAccount, type GoogleAccount } from './session'
import { loadGoogleSettings } from './settings'

/** The Google account the integrations act as, from the shared auth identity (Firebase or direct Google OAuth alike): a verified @amnex.com
 *  address with the API uid and Google's subject id. Anything less is no account. */
export function googleAccountFromAuthUser(user: AuthUser | null): GoogleAccount | null {
  if (!user?.emailVerified || !user.email?.toLowerCase().endsWith('@amnex.com') || !user.uid || !user.googleId) return null
  return { uid: user.uid, email: user.email.toLowerCase(), googleId: user.googleId }
}

/** One binding for the whole shell; changing user immediately drops all Google API tokens and the previous user's cached data. It rebinds only
 *  when the PERSON changes: an OAuth session re-emits the same user on every access-token refresh, and that must not drop tokens, reset the
 *  query cache or reload settings. */
export function GoogleAccountBinder() {
  const queryClient = useQueryClient()
  const { user } = useAuthUser()
  const account = googleAccountFromAuthUser(user)
  const uid = account?.uid
  const email = account?.email
  const googleId = account?.googleId
  useEffect(() => {
    const next = uid && email && googleId ? { uid, email, googleId } : null
    const previous = getGoogleAccount()
    const changed = previous?.uid !== next?.uid || previous?.email !== next?.email || previous?.googleId !== next?.googleId || !next
    if (changed) disconnectAllDrive()
    setGoogleAccount(next)
    if (changed) {
      // Reset also notifies mounted observers; clear alone can leave their old data visible.
      void queryClient.resetQueries().catch(() => undefined)
      queryClient.removeQueries({ type: 'inactive' })
    }
    if (next) void loadGoogleSettings(next).catch(() => undefined)
  }, [uid, email, googleId, queryClient])
  return null
}

import { useEffect } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '@/lib/firebaseAuth'
import { setGoogleAccount, type GoogleAccount } from './session'
import { loadGoogleSettings } from './settings'
import { disconnectAllDrive } from '@/features/dms/googleDrive'
import { getGoogleAccount } from './session'
import { useQueryClient } from '@tanstack/react-query'

export function googleAccountFromUser(user: User | null): GoogleAccount | null {
  const google = user?.providerData.find(provider => provider.providerId === 'google.com')
  if (!user?.emailVerified || !user.email?.toLowerCase().endsWith('@amnex.com') || !google?.uid) return null
  return { uid: user.uid, email: user.email.toLowerCase(), googleId: google.uid }
}
/** One binding for the whole shell; changing user immediately drops all Google API tokens. */
export function GoogleAccountBinder() {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!auth) { setGoogleAccount(null); disconnectAllDrive(); return }
    return onAuthStateChanged(auth, user => {
      const account = googleAccountFromUser(user)
      const previous = getGoogleAccount()
      const changed = previous?.uid !== account?.uid || previous?.email !== account?.email || previous?.googleId !== account?.googleId || !account
      if (changed) disconnectAllDrive()
      setGoogleAccount(account)
      if (changed) {
        // Reset also notifies mounted observers; clear alone can leave their old data visible.
        void queryClient.resetQueries().catch(() => undefined)
        queryClient.removeQueries({ type: 'inactive' })
      }
      if (account) void loadGoogleSettings(account).catch(() => undefined)
    })
  }, [queryClient])
  return null
}

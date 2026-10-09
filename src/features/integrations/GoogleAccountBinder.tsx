import { useEffect } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '@/lib/firebaseAuth'
import { setGoogleAccount, type GoogleAccount } from './session'
import { loadGoogleSettings } from './settings'

export function googleAccountFromUser(user: User | null): GoogleAccount | null {
  const google = user?.providerData.find(provider => provider.providerId === 'google.com')
  if (!user?.emailVerified || !user.email?.toLowerCase().endsWith('@amnex.com') || !google?.uid) return null
  return { uid: user.uid, email: user.email.toLowerCase(), googleId: google.uid }
}
/** One binding for the whole shell; changing user immediately drops all Google API tokens. */
export function GoogleAccountBinder() {
  useEffect(() => {
    if (!auth) { setGoogleAccount(null); return }
    return onAuthStateChanged(auth, user => {
      const account = googleAccountFromUser(user)
      setGoogleAccount(account)
      if (account) void loadGoogleSettings(account).catch(() => undefined)
    })
  }, [])
  return null
}

import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebaseAuth'

/** Is someone signed in with Firebase right now? False while signed out, before Firebase has reported, and when Firebase is not
 *  configured for this build (there is nothing to sign in to). Navigation uses it to decide which links to offer a visitor; it
 *  is not an authorization signal: every call is verified by the server. */
export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, (user) => setSignedIn(!!user))
  }, [])
  return signedIn
}

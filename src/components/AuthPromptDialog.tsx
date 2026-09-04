import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, type User } from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebaseAuth'
import { subscribeAuthRequired, type AuthPromptReason } from '@/lib/authPrompt'
import { Button } from '@/components/ui/Button'

export function AuthPromptDialog() {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<AuthPromptReason>('unauthorized')
  const [user, setUser] = useState<User | null>(null)
  const [signInError, setSignInError] = useState(false)

  // `auth` is null when Firebase isn't configured for this build (see
  // firebaseAuth.ts) — nothing to subscribe to in that case.
  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, setUser)
  }, [])
  useEffect(() => subscribeAuthRequired((r) => { setReason(r); setOpen(true); setSignInError(false) }), [])

  // Auto-close on a successful sign-in — but ONLY for 'unauthorized' (the
  // user simply wasn't signed in). For 'forbidden', the user is typically
  // already signed in with an account GOMS rejected (a non-@amnex.com
  // Google account); the fix for that isn't "sign in", it's "sign in with a
  // DIFFERENT, valid account". Auto-closing on any truthy `user` would close
  // the dialog the instant it opens for that case (since `user` is already
  // set), hiding the "not authorized" message the user still needs to see.
  useEffect(() => {
    if (open && reason === 'unauthorized' && user) setOpen(false)
  }, [open, reason, user])

  if (!open) return null

  function handleSignIn() {
    if (!auth) return
    setSignInError(false)
    signInWithPopup(auth, googleProvider).catch(() => setSignInError(true))
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-paper p-6 shadow-lg">
        {reason === 'forbidden' ? (
          <>
            <p className="text-sm font-medium text-ink">Your account isn't authorized</p>
            <p className="text-sm text-muted">
              {user?.email} is signed in, but GOMS requires a verified @amnex.com Google account for this action.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-ink">Sign in required</p>
            <p className="text-sm text-muted">
              Your session may have expired. Sign in with your Amnex Google account to continue.
            </p>
          </>
        )}
        {!auth && (
          <p className="text-xs text-muted">Sign-in is not configured for this deployment.</p>
        )}
        {signInError && (
          <p className="text-xs text-red-600">Sign-in failed. Try again.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!auth} onClick={handleSignIn}>Sign in with Google</Button>
        </div>
      </div>
    </div>
  )
}

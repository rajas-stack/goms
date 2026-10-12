import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authApi, useAuthUser } from '@/lib/auth'
import { ShellUpdateRequiredError } from '@/lib/auth/errors'
import { subscribeAuthRequired, type AuthPromptReason } from '@/lib/authPrompt'
import { Button } from '@/components/ui/Button'

export function AuthPromptDialog() {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<AuthPromptReason>('unauthorized')
  const { user } = useAuthUser()
  const [signInError, setSignInError] = useState<unknown>(null)
  const queryClient = useQueryClient()

  useEffect(() => subscribeAuthRequired((r) => { setReason(r); setOpen(true); setSignInError(null) }), [])

  // Recovers reads that failed while signed out (or signed in with the
  // wrong account) once a real identity shows up via the SAME
  // onAuthStateChanged this component already tracks — no second auth
  // mechanism. Scoped to queries currently sitting in an error state, not a
  // blanket refetch-everything, so it doesn't re-fetch data that already
  // loaded fine. A still-unauthorized account just fails the same way again
  // (identical to today's per-request behavior) rather than looping or
  // crashing. Without this, a read that 401'd before sign-in stayed stuck in
  // its error state until the user manually reloaded the page.
  useEffect(() => {
    if (!user) return
    void queryClient.refetchQueries({ predicate: (query) => query.state.status === 'error' })
  }, [user, queryClient])

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
    if (!authApi.configured) return
    setSignInError(null)
    // `?? new Error()` keeps a rejection with no reason (undefined/null) counted as a failure.
    authApi.signIn().catch((e: unknown) => setSignInError(e ?? new Error('sign-in failed')))
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-paper p-6 shadow-lg">
        {reason === 'forbidden' ? (
          <>
            <p className="text-sm font-medium text-ink">Your account isn't authorized</p>
            <p className="text-sm text-muted">
              {user?.email
                ? `${user.email} is signed in, but GOMS requires a verified @amnex.com Google account for this action.`
                : "That Google account isn't an @amnex.com account. GOMS needs a verified @amnex.com Google account for this action — sign in with a different one."}
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
        {!authApi.configured && (
          <p className="text-xs text-muted">Sign-in is not configured for this deployment.</p>
        )}
        {signInError !== null && (
          <p className="text-xs text-red-600">
            {signInError instanceof ShellUpdateRequiredError
              ? "This version of the GOMS app can't sign you in. Update the app and try again."
              : 'Sign-in failed. Try again.'}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!authApi.configured} onClick={handleSignIn}>Sign in with Google</Button>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { authApi, useAuthUser } from '@/lib/auth'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { OptionsMenu } from '@/components/theme/OptionsMenu'

/** Persistent sign-in indicator, visible on every screen (TopBar). Signing in
 *  sends the user to the full-page /login screen (returning here afterwards),
 *  and signing out returns them there so no internal page stays on screen;
 *  AuthPromptDialog remains the inline prompt for a session that expires
 *  mid-edit, so that flow doesn't lose the user's place. */
export function AuthStatus() {
  const { user } = useAuthUser()
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [signIn, setSignIn] = useState<{ open: boolean; error?: string }>({ open: false })
  const navigate = useNavigate()
  const location = useLocation()
  /** Opens Google's popup within the click, with a blocking dialog over the page until it finishes. */
  const startSignIn = () => {
    setSignIn({ open: true })
    authApi.signIn().then(
      () => setSignIn({ open: false }),
      (error: unknown) => setSignIn({ open: true, error: error instanceof Error ? error.message : 'Google sign-in failed.' }),
    )
  }

  // Settings remain accessible when this build cannot sign anyone in.
  if (!authApi.configured && authApi.kind !== 'google-local') return <OptionsMenu />

  if (!user) {
    return (
      <>
        <OptionsMenu
          onSignIn={() => {
            // The GOMS OAuth flow is a full-page redirect by design; the Google popup flows sign in right here.
            if (authApi.kind === 'oauth') {
              const here = location.pathname + location.search + location.hash
              navigate(`/login?next=${encodeURIComponent(here)}`)
              return
            }
            startSignIn()
          }}
        />
        <Dialog open={signIn.open} onClose={() => setSignIn({ open: false })} title="Sign in to GOMS"
          description="Choose your Google account in the window that opened. You stay on this page."
          footer={<>
            <Button onClick={() => setSignIn({ open: false })}>Cancel</Button>
            {signIn.error && <Button variant="primary" onClick={startSignIn}>Try again</Button>}
          </>}>
          {signIn.error
            ? <p role="alert" className="text-sm text-crimson">{signIn.error}</p>
            : <p className="flex items-center gap-2 text-sm text-muted"><Icon name="Loader" className="animate-spin" />Finish signing in in the Google window…</p>}
        </Dialog>
      </>
    )
  }

  return (
    <>
      <OptionsMenu
        profile={{ name: user.displayName || user.email || 'Signed in', photoUrl: user.photoUrl }}
        onSignOut={() => setConfirmSignOut(true)}
      />

      <Dialog
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title="Sign out?"
        description={user.email ?? undefined}
        footer={
          <>
            <Button onClick={() => setConfirmSignOut(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmSignOut(false)
                // Navigate only once sign-out has completed: arriving at /login
                // while still signed in would bounce straight back to home.
                // A failed sign-out leaves the user signed in and on the page —
                // the profile menu still shows them, so nothing more to report.
                // Local mode has no sign-in page to go to: signing out just leaves you here, as before signing in.
                authApi.signOut().then(() => { if (authApi.configured) navigate('/login', { replace: true }) }, () => {})
              }}
            >
              Sign out
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">You'll need to sign in again to make changes.</p>
      </Dialog>
    </>
  )
}

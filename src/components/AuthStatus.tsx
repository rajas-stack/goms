import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { authApi, useAuthUser } from '@/lib/auth'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { OptionsMenu } from '@/components/theme/OptionsMenu'

/** Persistent sign-in indicator, visible on every screen (TopBar). Signing in
 *  sends the user to the full-page /login screen (returning here afterwards),
 *  and signing out returns them there so no internal page stays on screen;
 *  AuthPromptDialog remains the inline prompt for a session that expires
 *  mid-edit, so that flow doesn't lose the user's place. */
export function AuthStatus() {
  const { user } = useAuthUser()
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Settings remain accessible when sign-in is not configured for this build.
  if (!authApi.configured) return <OptionsMenu />

  if (!user) {
    return (
      <OptionsMenu
        onSignIn={() => {
          const here = location.pathname + location.search + location.hash
          navigate(`/login?next=${encodeURIComponent(here)}`)
        }}
      />
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
                authApi.signOut().then(() => navigate('/login', { replace: true }), () => {})
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

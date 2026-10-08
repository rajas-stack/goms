import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth } from '@/lib/firebaseAuth'
import { notifyAuthRequired } from '@/lib/authPrompt'
import { Icon } from '@/components/ui/Icon'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { OptionsMenu } from '@/components/theme/OptionsMenu'

/** Persistent sign-in indicator, visible on every screen (TopBar) — not just
 *  reactively when a mutation gets rejected (AuthPromptDialog). Signing in
 *  reuses that same shared dialog via notifyAuthRequired rather than calling
 *  signInWithPopup itself, so there's one sign-in flow/error path, not two. */
export function AuthStatus() {
  const [user, setUser] = useState<User | null>(null)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, setUser)
  }, [])

  // Settings remain accessible when Firebase Auth is not configured.
  // Capture Auth locally so the sign-out callback keeps the narrowed type.
  if (!auth) return <OptionsMenu />
  const currentAuth = auth

  if (!user) {
    return (
      <>
      <OptionsMenu />
      <button
        onClick={() => notifyAuthRequired('unauthorized')}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted hover:bg-panel hover:text-ink lg:h-8"
      >
        <Icon name="LogIn" size={14} />
        <span className="hidden sm:inline">Sign in</span>
      </button>
      </>
    )
  }

  return (
    <>
      <OptionsMenu
        profile={{ name: user.displayName || user.email || 'Signed in', photoUrl: user.photoURL }}
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
                void signOut(currentAuth)
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

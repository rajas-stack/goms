import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth } from '@/lib/firebaseAuth'
import { notifyAuthRequired } from '@/lib/authPrompt'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'

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

  // Not configured for this build (e.g. goms-prod today, or local dev with
  // no .env.local) — nothing meaningful to show. Captured into a local so TS
  // narrows it to `Auth` inside the sign-out closure below too.
  if (!auth) return null
  const currentAuth = auth

  if (!user) {
    return (
      <button
        onClick={() => notifyAuthRequired('unauthorized')}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted hover:bg-panel hover:text-ink lg:h-8"
      >
        <Icon name="LogIn" size={14} />
        <span className="hidden sm:inline">Sign in</span>
      </button>
    )
  }

  return (
    <>
      <Tooltip label={user.email ?? 'Signed in'} side="bottom" className="shrink-0">
        <div className="flex h-11 items-center gap-1 rounded-full border border-line bg-panel py-1 pl-2.5 pr-1 text-[11px] font-medium text-ink-700 lg:h-8">
          <Icon name="User" size={12} />
          <span className="max-w-[9rem] truncate">{user.email}</span>
          <button
            onClick={() => setConfirmSignOut(true)}
            aria-label="Sign out"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white hover:text-ink-900 lg:h-6 lg:w-6"
          >
            <Icon name="LogOut" size={13} />
          </button>
        </div>
      </Tooltip>

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

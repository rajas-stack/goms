import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth } from '@/lib/firebaseAuth'
import { notifyAuthRequired } from '@/lib/authPrompt'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'

/** Persistent sign-in indicator, visible on every screen (TopBar) — not just
 *  reactively when a mutation gets rejected (AuthPromptDialog). Signing in
 *  reuses that same shared dialog via notifyAuthRequired rather than calling
 *  signInWithPopup itself, so there's one sign-in flow/error path, not two. */
export function AuthStatus() {
  const [user, setUser] = useState<User | null>(null)

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
    <Tooltip label={user.email ?? 'Signed in'} side="bottom" className="shrink-0">
      <div className="flex h-11 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 text-[11px] font-medium text-ink-700 lg:h-7">
        <Icon name="User" size={11} />
        <span className="max-w-[9rem] truncate">{user.email}</span>
        <button
          onClick={() => { void signOut(currentAuth) }}
          aria-label="Sign out"
          className="text-muted hover:text-ink-900"
        >
          <Icon name="LogOut" size={11} />
        </button>
      </div>
    </Tooltip>
  )
}

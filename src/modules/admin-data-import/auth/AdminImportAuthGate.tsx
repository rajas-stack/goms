import { useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebaseAuth'
import { Button } from '@/components/ui/Button'
import { useAdminImportDomains } from '../api'

function useAdminImportUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    // `auth` is null when Firebase isn't configured for this build (see
    // firebaseAuth.ts). Admin Data Import is itself gated behind
    // VITE_ADMIN_IMPORT_ENABLED, so in practice whoever enables that flag
    // also configures Firebase — but this must degrade gracefully (stuck on
    // the "sign in" screen, sign-in disabled) rather than crash either way.
    if (!auth) { setLoading(false); return }
    return onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false) })
  }, [])
  return { user, loading }
}

/** True only for a verified TRPCClientError carrying the server's FORBIDDEN
 *  code (apps/api/src/auth/verifyAdminImportToken.ts) — a signed-in Google
 *  account that isn't on ADMIN_IMPORT_ALLOWED_EMAILS. Deliberately narrow:
 *  any other error (network hiccup, UNAUTHORIZED from an expired token)
 *  falls through to the existing signed-in view instead of this screen, so
 *  this never claims "not authorized" for a reason that isn't actually that. */
function isForbiddenError(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null)?.data?.code === 'FORBIDDEN'
}

/** Who to email for access — whoever maintains ADMIN_IMPORT_ALLOWED_EMAILS
 *  (apps/api/src/auth/verifyAdminImportToken.ts). Not read from env: this is
 *  copy for a dead-end screen, not a security boundary. */
const ADMIN_IMPORT_CONTACT_EMAIL = 'rajas@amnex.com'

export type AdminImportAuthPhase = 'loading' | 'signedOut' | 'forbidden' | 'authorized'

export function AdminImportAuthGate({ children, onPhaseChange }: { children: ReactNode; onPhaseChange?: (phase: AdminImportAuthPhase, user: User | null) => void }) {
  const { user, loading } = useAdminImportUser()
  // The security boundary is the server (verifyAdminImportToken's allow-list
  // check, enforced on every adminImport.* call regardless of this gate) —
  // this probe only exists so a non-allow-listed signed-in account sees an
  // explicit "not authorized" screen instead of whatever a specific page's
  // own error handling (or lack of it) happens to show. listDomains is the
  // cheapest existing adminImport.* call and shares its cache with
  // AdminImportDashboard's own identical query, so this adds no extra
  // request once past this gate.
  const { isPending: authorizing, isError, error } = useAdminImportDomains({ enabled: !!user })

  // Optional — lets a caller (AdminImportModal) react to which screen this
  // gate is showing without duplicating its auth/allow-list logic. Fired
  // from an effect, never during render, since it's a side effect on a
  // value owned by this component, not this component's own output.
  const phase: AdminImportAuthPhase =
    loading || (!!user && authorizing) ? 'loading'
      : !user ? 'signedOut'
      : isError && isForbiddenError(error) ? 'forbidden'
      : 'authorized'
  useEffect(() => { onPhaseChange?.(phase, user) }, [phase, user, onPhaseChange])

  if (loading) return null

  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-paper p-8 text-center">
        <p className="max-w-sm text-sm text-muted">
          Sign in with your Amnex Google account to use Admin Data Import.
        </p>
        <Button variant="primary" disabled={!auth} onClick={() => auth && signInWithPopup(auth, googleProvider)}>
          Sign in with Google
        </Button>
        {!auth && <p className="text-xs text-muted">Sign-in is not configured for this deployment.</p>}
      </div>
    )
  }

  if (authorizing) return null

  if (isError && isForbiddenError(error)) {
    const requestAccessHref =
      `mailto:${ADMIN_IMPORT_CONTACT_EMAIL}?subject=${encodeURIComponent('Admin Data Import access request')}` +
      `&body=${encodeURIComponent(`Please add ${user.email} to Admin Data Import access.`)}`
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-paper p-8 text-center">
        <div className="max-w-sm space-y-1.5">
          <p className="text-sm font-medium text-ink">You're signed in, but not authorized for this</p>
          <p className="text-sm text-muted">
            {user.email} is a valid Google account, but it isn't on the Admin Data Import access list.
            This is separate from your regular GovCore access, which is unaffected.
          </p>
        </div>
        <a
          href={requestAccessHref}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-ink-900 px-4 text-sm font-medium text-paper shadow-sm transition-all duration-150 hover:bg-ink-800 focus-visible:focus-ring active:scale-[0.98]"
        >
          Request access
        </a>
        <Button variant="ghost" onClick={() => auth && signOut(auth)}>Sign out</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-3 border-b border-line px-4 py-2 text-xs text-muted">
        <span>Signed in as {user.email}</span>
        <Button variant="ghost" size="sm" onClick={() => auth && signOut(auth)}>Sign out</Button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

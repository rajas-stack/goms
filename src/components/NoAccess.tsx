import type { ReactNode } from 'react'
import type { PolicyModuleKey } from '@goms/domain'
import { usePermissions } from '@/lib/permissions'

export function NoAccess() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">You don't have access to this page</h1>
        <p className="mt-1 text-sm text-muted">Your role doesn't include it. Ask IT if you think that's a mistake.</p>
      </div>
    </div>
  )
}

export function NoRole() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">No role assigned</h1>
        <p className="mt-1 text-sm text-muted">You're signed in, but no GOMS role is set up for your account yet. Contact IT to be given access.</p>
      </div>
    </div>
  )
}

/** Opens a route only for a user who can read at least one of `anyOf`. Always open when RBAC is off. */
export function RequireAccess({ anyOf, children }: { anyOf: PolicyModuleKey[]; children: ReactNode }) {
  const p = usePermissions()
  if (!p.enforced) return <>{children}</>
  if (p.roles.length === 0) return <NoRole />
  return anyOf.some((m) => p.level(m) !== 'N') ? <>{children}</> : <NoAccess />
}

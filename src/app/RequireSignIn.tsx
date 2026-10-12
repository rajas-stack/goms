import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { RouteFallback } from '@/components/RouteFallback'
import { authApi, useAuthUser } from '@/lib/auth'
import { isAmnexAccount } from '@/lib/useGoogleSignIn'

/** Nothing inside the app shell renders until someone with an accepted (verified @amnex.com) Google account is signed in;
 *  everyone else lands on /login and is sent back to the page they asked for afterwards. A build that cannot sign anyone in
 *  (no Firebase config: local in-memory dev, tests) passes straight through. UX only — the API authorises every request. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthUser()
  const location = useLocation()
  if (!authApi.configured) return <>{children}</>
  if (loading) return <RouteFallback />
  if (!user || !isAmnexAccount(user)) {
    const next = location.pathname + location.search + location.hash
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}

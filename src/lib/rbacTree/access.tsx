import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { treeAllows, type RbacAction, type RbacMyAccess } from '@goms/domain'
import { repository } from '@/data/repository'
import { useAuthUser } from '@/lib/auth'

/** No configuration = nothing restricted. Also the value outside the provider (tests, screens rendered alone). */
const OPEN: RbacMyAccess = { configured: false, allowed: {} }
const Ctx = createContext<RbacMyAccess>(OPEN)

export const RBAC_MY_ACCESS_KEY = ['rbacTree', 'myAccess'] as const

/** Loads the signed-in user's resolved tree once (cached like auth.me). While loading, or when the call fails, nothing is
 *  hidden: the tree is a UI layer and the server policy is the security floor. */
export function NodeAccessProvider({ children, access }: { children: ReactNode; access?: RbacMyAccess }) {
  const { user } = useAuthUser()
  const email = user?.email ?? null
  const { data } = useQuery({
    queryKey: [...RBAC_MY_ACCESS_KEY, email], queryFn: () => repository.getRbacMyAccess(email), staleTime: 60_000, retry: false,
    enabled: !access,
  })
  const value = useMemo(() => access ?? data ?? OPEN, [access, data])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useRbacTreeAccess = (): RbacMyAccess => useContext(Ctx)

/** May the user perform `action` on `nodeId` according to the permission tree? */
export function useNodeAccess(nodeId: string, action: RbacAction = 'view'): boolean {
  return treeAllows(useContext(Ctx), nodeId, action)
}

/** A predicate for filtering tab bars and lists by node. */
export function useNodeFilter(): (nodeId: string, action?: RbacAction) => boolean {
  const access = useContext(Ctx)
  return (nodeId, action = 'view') => treeAllows(access, nodeId, action)
}

/** Renders children only when the tree allows `action` on `node`. */
export function Secured({ node, action = 'view', fallback = null, children }: {
  node: string; action?: RbacAction; fallback?: ReactNode; children: ReactNode
}) {
  return <>{useNodeAccess(node, action) ? children : fallback}</>
}

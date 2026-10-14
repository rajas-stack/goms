import type { ReactNode } from 'react'
import { NoAccess } from '@/components/NoAccess'
import { useNodeAccess } from './access'

/** Route guard: renders NoAccess when the permission tree hides `node` from this user. */
export function RequireNode({ node, children }: { node: string; children: ReactNode }) {
  return useNodeAccess(node) ? <>{children}</> : <NoAccess />
}

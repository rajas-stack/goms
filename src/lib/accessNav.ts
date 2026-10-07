import { usePermissions } from './permissions'
import { useSignedIn } from './useSignedIn'

/**
 * Should the navigation offer "Role & Access"? One rule for the desktop rail and the mobile drawer, so they cannot disagree.
 *
 * - enforce: only when the role can open it (anything above "no access" on admin.access: System Admin, IT, CXO read-only).
 * - off / shadow: to any signed-in user. With RBAC off the browser has no roles to judge by, and the screen itself is gated on
 *   the server: a viewer who may not use it gets an explicit "Only System Admins can manage access" message there.
 * - nothing known yet (`auth.me` has not answered, or failed): not offered.
 *
 * LINK VISIBILITY IS NOT AUTHORIZATION. Hiding or showing this link changes nothing about who can open the screen or what they
 * can do there: the route guard (`RequireAccess`) and, above all, the server decide.
 */
export function useShowAccessNav(): boolean {
  const perms = usePermissions()
  const signedIn = useSignedIn()
  if (perms.enforced) return perms.level('admin.access') !== 'N'
  return perms.mode !== undefined && signedIn
}

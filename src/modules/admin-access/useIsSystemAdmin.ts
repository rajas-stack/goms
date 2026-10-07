import { usePermissions, type Permissions } from '@/lib/permissions'

/** `yes` / `no` when `auth.me` told us, `unknown` when it could not (RBAC off reports no roles; not loaded yet; failed). */
export type SystemAdminStatus = 'yes' | 'no' | 'unknown'

/**
 * Is the viewer a System Admin? **UX ONLY** (what to show or hide): the server is the authorization boundary and re-checks every
 * write against ADMIN_ALLOWED_EMAILS in every RBAC mode, so a wrong answer here can only show or hide a control, never grant
 * or deny anything. System Admin comes only from that server-side allow-list; nothing in the browser can create it.
 *
 * - `shadow` / `enforce`: `auth.me` reports the caller's roles, and `system_admin` is one of them for an allow-listed email.
 * - RBAC off: `auth.me` reports no roles. The access API is allow-list-gated on the server in that mode, so a viewer whose
 *   readiness read SUCCEEDED (`readinessSucceeded`, passed by the Role & Access screen, which makes that call) is a System
 *   Admin. Elsewhere there is nothing to ask, and the answer is `unknown`.
 */
export function systemAdminStatus(p: Pick<Permissions, 'mode' | 'systemAdmin'>, readinessSucceeded = false): SystemAdminStatus {
  if (p.systemAdmin) return 'yes'
  if (p.mode === 'shadow' || p.mode === 'enforce') return 'no' // the server reported the roles, and System Admin is not among them
  if (p.mode === 'off') return readinessSucceeded ? 'yes' : 'unknown'
  return 'unknown'
}

export const useSystemAdminStatus = (readinessSucceeded = false): SystemAdminStatus => systemAdminStatus(usePermissions(), readinessSucceeded)

/** True only when the viewer is known to be a System Admin. UX only: see {@link systemAdminStatus}. */
export const useIsSystemAdmin = (readinessSucceeded = false): boolean => useSystemAdminStatus(readinessSucceeded) === 'yes'

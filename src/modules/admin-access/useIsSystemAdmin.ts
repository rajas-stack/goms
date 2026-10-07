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

/**
 * Should an email-binding field (org person / team member email) be offered as editable? Yes for a System Admin AND while the
 * browser cannot tell (RBAC off, `auth.me` not answered): hiding it then would take the field away from the very System Admins
 * who need it, and the server refuses a change from anyone else in every RBAC mode and the screen shows that refusal. A
 * viewer the server reported as NOT a System Admin (shadow / enforce) gets read-only text. UX only, like useIsSystemAdmin.
 */
export const useCanEditEmailBinding = (): boolean => useSystemAdminStatus() !== 'no'

/** Shown next to every email-binding field. */
export const EMAIL_BINDING_HELP = "Used to derive this person's role. Only System Admins can change it."

/** Shown when a typed email has no "@" (the stored value is put back). */
export const EMAIL_FORMAT_MESSAGE = 'That does not look like an email address (it needs an @). The stored email was kept.'
/** Clearing an email unbinds the person from the role it derives, so the clear is confirmed. */
export const clearEmailConfirmText = (name: string): string =>
  `Clear ${name}'s email? Their role is derived from it, so they will lose the role (and any team assignments) that email gave them until an email is set again.`

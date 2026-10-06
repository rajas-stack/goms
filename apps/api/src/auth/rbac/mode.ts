import type { RbacMode } from '@goms/domain'

/** `RBAC_MODE` = off (default) | shadow | enforce — and only meaningful when auth is enforced, because RBAC needs an
 *  identity. A misspelled value is `off`: the deployed default is a no-op, never a guess. */
export function rbacMode(): RbacMode {
  if (process.env.AUTH_ENFORCEMENT_ENABLED !== 'true') return 'off'
  const raw = process.env.RBAC_MODE
  return raw === 'shadow' || raw === 'enforce' ? raw : 'off'
}

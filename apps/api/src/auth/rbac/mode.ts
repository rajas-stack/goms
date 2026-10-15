import type { RbacMode } from '@goms/domain'
import { productionSecurity } from '../../security/config.js'

/** `RBAC_MODE` = off (default) | shadow | enforce — and only meaningful when auth is enforced, because RBAC needs an
 *  identity. A misspelled value is `off`: the deployed default is a no-op, never a guess. */
export function rbacMode(): RbacMode {
  // Production authentication hardening is always on (security/config.ts), but RBAC activation is its own switch so a release can
  // ship hardened and move off -> shadow -> enforce deliberately (docs/superpowers/analysis/2026-10-rbac-rollout-runbook.md).
  // Unset stays `enforce`: only an explicit `off` or `shadow` relaxes it.
  if (productionSecurity()) {
    const raw = process.env.RBAC_MODE
    return raw === 'off' || raw === 'shadow' ? raw : 'enforce'
  }
  if (process.env.AUTH_ENFORCEMENT_ENABLED !== 'true') return 'off'
  const raw = process.env.RBAC_MODE
  return raw === 'shadow' || raw === 'enforce' ? raw : 'off'
}

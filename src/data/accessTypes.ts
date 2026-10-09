import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../apps/api/src/index'

/** Shapes of the Role & Access queries, taken from the server router itself so the screen can never drift from what the server
 *  returns. Type-only: nothing here exists at runtime. */
type AccessOutputs = inferRouterOutputs<AppRouter>['access']

/** The role x module permission matrix, the field sets and the System Admin only restrictions (`access.permissionMatrix`). */
export type PermissionMatrix = AccessOutputs['permissionMatrix']
/** What one person can do per module, computed by the server (`access.effectivePermissions`). */
export type EffectivePermissions = AccessOutputs['effectivePermissions']
/** An override whose email is not attached to any person row (`access.unmatchedOverrides`). */
export type UnmatchedOverride = AccessOutputs['unmatchedOverrides'][number]
/** One audited override change (`access.overrideHistory`). */
export type OverrideHistoryRow = AccessOutputs['overrideHistory'][number]
export type OverrideHistoryFilter = { email?: string; role?: string }

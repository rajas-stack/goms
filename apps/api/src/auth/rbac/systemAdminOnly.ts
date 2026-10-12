import type { PolicyModuleKey } from '@goms/domain'
import { TRPCError } from '@trpc/server'
import { isAllowListed } from '../identity.js'
import { RbacDenial } from './denial.js'

/** System Admin membership is env-only: `ADMIN_ALLOWED_EMAILS` (RBAC spec §3.4). `isSystemAdminEmail` is the shared "is this address a
 *  System Admin?" question for the override writers (routers/access.ts) and the System-Admin-only guards below; userFacts.ts,
 *  trpc.ts and the readiness list read the same variable through the same `isAllowListed` parser. Nothing here can write the list. */
export const isSystemAdminEmail = (email: string): boolean => isAllowListed(email, process.env.ADMIN_ALLOWED_EMAILS)

export interface SystemAdminOnlyRule {
  id: string
  /** `procedure`: the whole procedure is System Admin only. `field`: `<router>.<procedure>#<input field>` — only changes to that field are. */
  kind: 'procedure' | 'field'
  target: string
  module?: PolicyModuleKey
  actions: ('write' | 'create' | 'delete')[]
  /** Shown to people in the Role & Access screen. */
  reason: string
}

/**
 * What the permission matrix (packages/domain/src/rbac/policy.ts) deliberately does NOT express: the few actions that stay
 * System Admin only even though a functional role holds the module permission. The matrix is unchanged; these rules are an extra,
 * explicit server-side layer that applies in EVERY RBAC mode (off, shadow and enforce), on top of the registry gate:
 *   - procedures are guarded by `systemAdminProcedure` (trpc.ts);
 *   - field rules are checked inside the procedure body with `requireSystemAdmin`;
 *   - the permission-matrix / effective-permissions queries surface this list, so the UI shows what the server really enforces.
 * Adding a rule here without enforcing it is caught by systemAdminOnly.test.ts (every rule must have a test case).
 */
export const SYSTEM_ADMIN_ONLY: readonly SystemAdminOnlyRule[] = [
  {
    id: 'access.setOverride', kind: 'procedure', target: 'access.setOverride', module: 'admin.access', actions: ['write', 'create', 'delete'],
    reason: 'Role overrides decide who can see and change business data, so only a System Admin can create or change them.',
  },
  {
    id: 'access.removeOverride', kind: 'procedure', target: 'access.removeOverride', module: 'admin.access', actions: ['write', 'create', 'delete'],
    reason: 'Role overrides decide who can see and change business data, so only a System Admin can remove them.',
  },
  {
    id: 'orgPeople.create#email', kind: 'field', target: 'orgPeople.create#email', module: 'team.org', actions: ['create'],
    reason: "An org person's email is what derives their role, so only a System Admin can set it when adding a person.",
  },
  {
    id: 'orgPeople.update#email', kind: 'field', target: 'orgPeople.update#email', module: 'team.org', actions: ['write'],
    reason: "An org person's email is what derives their role, so only a System Admin can change it.",
  },
  {
    id: 'deliveryTeams.create#email', kind: 'field', target: 'deliveryTeams.create#email', module: 'team.org', actions: ['create'],
    reason: "A team member's email binds their login to their team assignments, so only a System Admin can set it when adding a member.",
  },
  {
    id: 'deliveryTeams.update#email', kind: 'field', target: 'deliveryTeams.update#email', module: 'team.org', actions: ['write'],
    reason: "A team member's email binds their login to their team assignments, so only a System Admin can change it.",
  },
]

export const EMAIL_BINDING_MESSAGE = 'Only a System Admin can set or change an email address.'
export const ORG_SYNC_EMAIL_MESSAGE =
  "This change would link an existing team member to this person and replace the member's email address, which only a System Admin can do."

/** The caller of a procedure, as tRPC's context carries them (set only when auth is enforced). */
export interface CallerContext { user?: { email: string } }

/** True when the caller is on the env allow-list. A missing identity is never a System Admin. */
export const isSystemAdminCaller = (ctx: CallerContext): boolean => !!ctx.user && isSystemAdminEmail(ctx.user.email)

/** The same one-line check as trpc.ts / mode.ts: with auth not enforced no identity exists, so these rules are a no-op
 *  (the convention of `adminProcedure` / `accessProcedure`); deployed environments always enforce auth. */
const authEnforced = (): boolean => process.env.AUTH_ENFORCEMENT_ENABLED === 'true'

/** True when the System Admin rules bind this caller: auth is enforced and they are not on the allow-list. */
export const lacksSystemAdmin = (ctx: CallerContext): boolean => authEnforced() && !isSystemAdminCaller(ctx)

/**
 * Throws FORBIDDEN unless the caller is a System Admin (a no-op when auth is not enforced). The error carries an
 * `RbacDenial`, so the browser shows an ordinary "no permission" message instead of the "sign in with your @amnex.com
 * account" prompt that every other FORBIDDEN triggers. `target` (a rule id) fills in which module / action was refused.
 */
export function requireSystemAdmin(ctx: CallerContext, message = 'Only a System Admin can do this.', target?: string): void {
  if (!lacksSystemAdmin(ctx)) return
  const rule = SYSTEM_ADMIN_ONLY.find((r) => r.id === target)
  throw new TRPCError({
    code: 'FORBIDDEN', message,
    cause: new RbacDenial(message, { module: rule?.module ?? 'admin.access', action: rule?.actions[0] === 'create' ? 'create' : 'update' }),
  })
}

/** For an `email` input field: whether this write changes the stored value (trimmed, case-insensitive). `incoming === undefined`
 *  means the field is not part of the call. An empty stored value and an empty incoming value are equal. */
export function emailChanges(incoming: string | undefined, stored: string | null | undefined): boolean {
  if (incoming === undefined) return false
  return incoming.trim().toLowerCase() !== (stored ?? '').trim().toLowerCase()
}

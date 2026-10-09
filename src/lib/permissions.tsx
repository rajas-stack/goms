import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  accessFor, allows, canReadAtom as domainCanReadAtom, GRANTS, type Level, type MaskedAtom, type PolicyModuleKey, type Role, type ScopeFacts, type UserFacts,
} from '@goms/domain'
import type { MyAccess } from '../../apps/api/src/routers/auth'
import { resolveActiveRole, useStoredRole, writeStoredRole } from './activeRole'
import { useMyAccess } from './api'

export interface Permissions {
  /** False when RBAC is off (or not yet known): everything is shown, the server is still the authority. */
  enforced: boolean
  /** The roles every decision below is evaluated with: all of the user's roles, or just `activeRole` when one is selected. */
  roles: UserFacts['roles']
  /** Every role the SERVER reports for this user (empty while RBAC is not enforced). The role switcher lists exactly these. */
  allRoles: UserFacts['roles']
  /** The one role the user chose to view the app as, or null for "All my roles". A UI-only narrowing: it can hide or disable
   *  things the user's full role set allows, never reveal more. The server still authorises with the full role set. */
  activeRole: Role | null
  setActiveRole(role: Role | null): void
  level(module: PolicyModuleKey): Level
  can(module: PolicyModuleKey, action: 'read' | 'create' | 'delete', row?: ScopeFacts): boolean
  canEdit(module: PolicyModuleKey, atom: string, row?: ScopeFacts): boolean
  canReadAtom(atom: MaskedAtom): boolean
  /** Could this role edit the module on SOME row? For screens that do not know the row (the server decides per row). */
  mayWrite(module: PolicyModuleKey): boolean
}

const OPEN: Permissions = {
  enforced: false, roles: [], allRoles: [], activeRole: null, setActiveRole: () => {}, level: () => 'W', can: () => true, canEdit: () => true, canReadAtom: () => true, mayWrite: () => true,
}
const Ctx = createContext<Permissions>(OPEN)

function build(access: MyAccess | undefined, activeRole: Role | null, setActiveRole: (role: Role | null) => void): Permissions {
  // `shadow` only logs on the server, so the UI behaves exactly as it does with RBAC off until `enforce`.
  if (!access || access.mode !== 'enforce' || !access.facts) return OPEN
  // Narrowing replaces the role list with the one chosen role (a role the server reported: `activeRole` is validated against
  // `access.roles` by the caller). With no selection this is the unchanged multi-role union.
  const user: UserFacts = { email: access.email ?? '', roles: activeRole ? [activeRole] : access.roles, ...access.facts }
  return {
    enforced: true,
    roles: user.roles,
    allRoles: access.roles,
    activeRole,
    setActiveRole,
    level: (m) => accessFor(user, m).level,
    can: (m, action, row) => {
      const a = accessFor(user, m, row)
      return action === 'read' ? a.level !== 'N' : action === 'create' ? a.create : a.delete
    },
    canEdit: (m, atom, row) => allows(accessFor(user, m, row), atom),
    canReadAtom: (atom) => domainCanReadAtom(user.roles, atom),
    mayWrite: (m) => user.roles.some((r) => GRANTS[m][r].level === 'P' || GRANTS[m][r].level === 'W'),
  }
}

/** Props `access` lets tests inject; in the app the provider reads `auth.me` itself. */
export function PermissionsProvider({ children, access }: { children: ReactNode; access?: MyAccess }) {
  const { data } = useMyAccess()
  const resolved = access ?? data
  const enforced = resolved?.mode === 'enforce' && Boolean(resolved.facts)
  const email = resolved?.email ?? ''
  const saved = useStoredRole(email)
  // Only a role the server still reports counts; anything else is "All my roles".
  const activeRole = enforced && resolved ? resolveActiveRole(saved, resolved.roles) : null

  // Discard a saved selection that is no longer valid (role removed, user down to one role) — once per user, when real role data
  // first arrives. An invalid value is never honoured regardless (resolveActiveRole), so this only tidies storage. It must NOT
  // re-run on later storage changes: another tab with a newer role list may have just saved a choice this tab does not know yet.
  const swept = useRef<string | null>(null)
  useEffect(() => {
    if (!enforced || swept.current === email) return
    swept.current = email
    if (saved !== null && activeRole === null) writeStoredRole(email, null)
  }, [enforced, saved, activeRole, email])

  const value = useMemo(() => build(resolved, activeRole, (role) => writeStoredRole(email, role)), [resolved, activeRole, email])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePermissions = (): Permissions => useContext(Ctx)

/** True when RBAC is off, or the user can read at least one of `modules`. For hiding navigation entries. */
export function useCanReadAny(modules: readonly PolicyModuleKey[]): boolean {
  const p = usePermissions()
  return !p.enforced || modules.some((m) => p.level(m) !== 'N')
}

export type PermissionAction = 'read' | 'create' | 'update' | 'delete'

/** The one rule behind <Can> and useAllowed: an update with an atom needs that field; without one it needs full write. */
function isAllowed(p: Permissions, module: PolicyModuleKey, action: PermissionAction, atom?: string, row?: ScopeFacts): boolean {
  return action === 'update' ? (atom ? p.canEdit(module, atom, row) : p.level(module) === 'W') : p.can(module, action, row)
}

/** Title for a control the role cannot use. */
export const NO_PERMISSION_TITLE = "Your role can't do this"

/** For disabling a control: may this role perform `action` here? Always true when RBAC is off. The server still decides. */
export function useAllowed(module: PolicyModuleKey, action: PermissionAction, atom?: string, row?: ScopeFacts): boolean {
  return isAllowed(usePermissions(), module, action, atom, row)
}

/** Renders children only when the action is allowed (or when `fallback` is given, renders that instead). */
export function Can({
  module, action = 'update', atom, row, fallback = null, children,
}: {
  module: PolicyModuleKey; action?: PermissionAction; atom?: string; row?: ScopeFacts
  fallback?: ReactNode; children: ReactNode
}) {
  const p = usePermissions()
  return <>{isAllowed(p, module, action, atom, row) ? children : fallback}</>
}

/** Disables every native control inside (buttons, inputs, selects) when the role may not use them. A `<fieldset disabled>`
 *  rather than per-control props, so a whole tab can be gated in one place. The server still decides. */
export function Gate({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <fieldset disabled={!allowed} className="contents">{children}</fieldset>
}

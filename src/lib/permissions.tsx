import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  accessFor, allows, canReadAtom as domainCanReadAtom, GRANTS, type Level, type MaskedAtom, type PolicyModuleKey, type RbacMode, type ScopeFacts, type UserFacts,
} from '@goms/domain'
import type { MyAccess } from '../../apps/api/src/routers/auth'
import { useMyAccess } from './api'

export interface Permissions {
  /** False when RBAC is off (or not yet known): everything is shown, the server is still the authority. */
  enforced: boolean
  roles: UserFacts['roles']
  level(module: PolicyModuleKey): Level
  can(module: PolicyModuleKey, action: 'read' | 'create' | 'delete', row?: ScopeFacts): boolean
  canEdit(module: PolicyModuleKey, atom: string, row?: ScopeFacts): boolean
  canReadAtom(atom: MaskedAtom): boolean
  /** Could this role edit the module on SOME row? For screens that do not know the row (the server decides per row). */
  mayWrite(module: PolicyModuleKey): boolean
  /** What `auth.me` reported as the RBAC mode; undefined until it has answered (or when it failed). UX only. */
  mode?: RbacMode
  /** `auth.me` reported this caller as a System Admin. Only known in `shadow` / `enforce` (with RBAC off the server reports no
   *  roles). UX ONLY, like every other flag here: the server is the authorization boundary (see useIsSystemAdmin). */
  systemAdmin?: boolean
}

const OPEN: Permissions = {
  enforced: false, roles: [], level: () => 'W', can: () => true, canEdit: () => true, canReadAtom: () => true, mayWrite: () => true,
}
const Ctx = createContext<Permissions>(OPEN)

function build(access: MyAccess | undefined): Permissions {
  if (!access) return OPEN
  const reported = { mode: access.mode, systemAdmin: access.mode !== 'off' && access.roles.includes('system_admin') }
  // `shadow` only logs on the server, so the UI behaves exactly as it does with RBAC off until `enforce`.
  if (access.mode !== 'enforce' || !access.facts) return { ...OPEN, ...reported }
  const user: UserFacts = { email: access.email ?? '', roles: access.roles, ...access.facts }
  return {
    ...reported,
    enforced: true,
    roles: user.roles,
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
  const value = useMemo(() => build(access ?? data), [access, data])
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

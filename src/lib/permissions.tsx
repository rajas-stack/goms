import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  accessFor, allows, canReadAtom as domainCanReadAtom, type Level, type MaskedAtom, type PolicyModuleKey, type ScopeFacts, type UserFacts,
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
}

const OPEN: Permissions = {
  enforced: false, roles: [], level: () => 'W', can: () => true, canEdit: () => true, canReadAtom: () => true,
}
const Ctx = createContext<Permissions>(OPEN)

function build(access: MyAccess | undefined): Permissions {
  if (!access || access.mode === 'off' || !access.facts) return OPEN
  const user: UserFacts = { email: access.email ?? '', roles: access.roles, ...access.facts }
  return {
    enforced: true,
    roles: user.roles,
    level: (m) => accessFor(user, m).level,
    can: (m, action, row) => {
      const a = accessFor(user, m, row)
      return action === 'read' ? a.level !== 'N' : action === 'create' ? a.create : a.delete
    },
    canEdit: (m, atom, row) => allows(accessFor(user, m, row), atom),
    canReadAtom: (atom) => domainCanReadAtom(user.roles, atom),
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

/** Renders children only when the action is allowed (or when `fallback` is given, renders that instead). */
export function Can({
  module, action = 'update', atom, row, fallback = null, children,
}: {
  module: PolicyModuleKey; action?: 'read' | 'create' | 'update' | 'delete'; atom?: string; row?: ScopeFacts
  fallback?: ReactNode; children: ReactNode
}) {
  const p = usePermissions()
  const ok = action === 'update' ? (atom ? p.canEdit(module, atom, row) : p.level(module) === 'W') : p.can(module, action, row)
  return <>{ok ? children : fallback}</>
}

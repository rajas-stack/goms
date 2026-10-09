import {
  FIELD_SETS, GRANTS, IMPLIED_READS, MODULES, ROLES, ROLE_LABELS, accessFor, grantFor,
  type Level, type PolicyModuleKey, type Role, type Scope, type UserFacts,
} from '@goms/domain'
import { SYSTEM_ADMIN_ONLY, type SystemAdminOnlyRule } from './systemAdminOnly.js'

/**
 * Read-only views of the RBAC policy for the Role & Access screen. Everything here is DERIVED from the domain package's own
 * exports (GRANTS / grantFor / FIELD_SETS / MODULES / accessFor) and from SYSTEM_ADMIN_ONLY: nothing is hand-copied, so the
 * screen can never drift from what the server enforces. Responses are fresh copies (callers cannot mutate the domain matrix).
 */

/** The policy modules in registry order: every module that has grants (the derived Master Grid has none). */
const policyModules = (): { key: PolicyModuleKey; label: string; group: string }[] =>
  MODULES.filter((m) => m.key in GRANTS).map((m) => ({ key: m.key as PolicyModuleKey, label: m.label, group: m.group }))

const label = (key: PolicyModuleKey): string => MODULES.find((m) => m.key === key)?.label ?? key

const restrictionView = (r: SystemAdminOnlyRule) => ({ id: r.id, kind: r.kind, target: r.target, module: r.module, actions: [...r.actions], reason: r.reason })

export interface GrantView { level: Level; scope: Scope; sets: string[]; create: boolean; delete: boolean }

export function buildPermissionMatrix() {
  const modules = policyModules()
  const grants = {} as Record<PolicyModuleKey, Record<Role, GrantView>>
  for (const { key } of modules) {
    const byRole = {} as Record<Role, GrantView>
    for (const role of ROLES) {
      const g = grantFor(key, role)
      byRole[role] = { level: g.level, scope: g.scope, sets: [...g.sets], create: g.create, delete: g.delete }
    }
    grants[key] = byRole
  }
  return {
    roles: ROLES.map((key) => ({ key, label: ROLE_LABELS[key], /** System Admin has no restricted cells: W on every module, every field. */ unrestricted: key === 'system_admin' })),
    modules,
    grants,
    fieldSets: Object.fromEntries(Object.entries(FIELD_SETS).map(([name, atoms]) => [name, [...atoms]])) as Record<string, string[]>,
    restrictions: SYSTEM_ADMIN_ONLY.map(restrictionView),
  }
}

/** A held `P`/`W` grant that is limited to rows in the person's own / assigned scope. */
export interface ScopedGrantView { role: Role; scope: Exclude<Scope, 'all'>; level: 'P' | 'W'; sets: string[]; create: boolean; delete: boolean }

/**
 * What `user` can do per module, as the server's own evaluator (`accessFor`, no row) answers it, plus what that answer cannot
 * show without a row: grants limited to `own` / `asg` rows are listed in `scoped` (the evaluator needs the row's owner /
 * assignment to apply them). Restrictions come from SYSTEM_ADMIN_ONLY and are shown only for people who are not System Admins.
 */
export function describeEffectivePermissions(user: UserFacts) {
  const systemAdmin = user.roles.includes('system_admin')
  const held = user.roles.filter((r): r is Role => r !== 'system_admin')
  const modules = policyModules().map(({ key, label: moduleLabel, group }) => {
    const access = accessFor(user, key)
    const grants = held.map((role) => ({ role, g: grantFor(key, role) }))
    // Level P comes only from `P` grants over scope `all` (without a row nothing else applies): their named sets.
    const sets = access.level === 'P' ? [...new Set(grants.filter(({ g }) => g.level === 'P' && g.scope === 'all').flatMap(({ g }) => g.sets))] : []
    const scoped: ScopedGrantView[] = systemAdmin ? [] : grants
      .filter(({ g }) => g.scope !== 'all' && (g.level === 'P' || g.level === 'W'))
      .map(({ role, g }) => ({ role, scope: g.scope as Exclude<Scope, 'all'>, level: g.level as 'P' | 'W', sets: [...g.sets], create: g.create, delete: g.delete }))
    const rules = systemAdmin ? [] : SYSTEM_ADMIN_ONLY.filter((r) => r.module === key)
    return {
      module: key, label: moduleLabel, group,
      level: access.level, sets, create: access.create, delete: access.delete,
      scoped,
      restrictions: rules.map(restrictionView),
      // Write, create and delete here are System Admin only whatever the matrix says (a whole-procedure rule, e.g. role overrides).
      ...(rules.some((r) => r.kind === 'procedure') ? { restrictedTo: 'System Admin' as const } : {}),
    }
  })

  const notes: string[] = []
  if (systemAdmin) notes.push('System Admin is unrestricted: every module and every field. It comes only from the protected admin allow-list, never from an override.')
  if (user.roles.length === 0) notes.push('This person has no role, so only baseline access applies (Geography is read-only).')
  if (modules.some((m) => m.scoped.length > 0)) {
    notes.push("Edit rights limited to own or assigned rows depend on each row's owner or assignment, so a module level cannot show them without a row: see the scoped entries.")
  }
  if (modules.some((m) => m.restrictions.length > 0)) {
    notes.push('Some actions stay System Admin only whatever the role (marked on the modules), for example changing role overrides or email addresses.')
  }
  if (!systemAdmin) {
    for (const [source, targets] of Object.entries(IMPLIED_READS) as [PolicyModuleKey, readonly PolicyModuleKey[]][]) {
      if (accessFor(user, source).level === 'N') continue
      const implied = targets.filter((t) => held.every((r) => grantFor(t, r).level === 'N'))
      if (implied.length) notes.push(`Read access to ${label(source)} also gives read-only access to ${implied.map(label).join(' and ')}.`)
    }
  }

  return { email: user.email, roles: [...user.roles], systemAdmin, modules, notes }
}

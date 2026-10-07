import { FUNCTIONAL_ROLES, MODULES, ROLE_LABELS, ROLES } from '@goms/domain'
import type { EffectivePermissions, OverrideHistoryRow, PermissionMatrix, UnmatchedOverride } from '@/data/accessTypes'

/** Server-shaped fixtures for the Role & Access component tests (what `access.*` returns). Hand-built on purpose: the screen must
 *  render whatever the server sends, so these do not read the real policy matrix. */

const cell = (level: 'N' | 'R' | 'P' | 'W', scope: 'all' | 'own' | 'asg' = 'all', sets: string[] = [], create = false, del = false) => ({ level, scope, sets, create, delete: del })

export function matrixFixture(): PermissionMatrix {
  const modules = MODULES.filter((m) => m.key !== 'opp.master').map((m) => ({ key: m.key, label: m.label, group: m.group }))
  const grants: Record<string, Record<string, ReturnType<typeof cell>>> = {}
  for (const m of modules) {
    grants[m.key] = Object.fromEntries(ROLES.map((r) => [r, r === 'system_admin' ? cell('W', 'all', [], true, true) : cell('R')]))
  }
  grants['opp.pipeline'].sales = cell('W', 'own', [], true)
  grants['opp.bidTracker'].presales = cell('P', 'asg', ['P1'])
  grants['opp.bidTracker'].bid = cell('W', 'all', [], true, true)
  grants['com.skus'].finance = cell('P', 'all', ['F1'])
  grants['com.skus'].sales = cell('N')
  grants['admin.access'].cxo = cell('R')
  grants['admin.access'].it = cell('W', 'all', [], true, true)
  return {
    roles: ROLES.map((key) => ({ key, label: ROLE_LABELS[key], unrestricted: key === 'system_admin' })),
    modules,
    grants,
    fieldSets: { P1: ['bid.nextAction', 'bid.custom'], F1: ['sku.costs', 'sku.floor', 'sku.tax'] },
    restrictions: [
      { id: 'access.setOverride', kind: 'procedure', target: 'access.setOverride', module: 'admin.access', actions: ['write', 'create', 'delete'], reason: 'Role overrides decide who can see and change business data, so only a System Admin can create or change them.' },
      { id: 'orgPeople.update#email', kind: 'field', target: 'orgPeople.update#email', module: 'team.org', actions: ['write'], reason: "An org person's email is what derives their role, so only a System Admin can change it." },
    ],
  } as unknown as PermissionMatrix
}

export const MATRIX_ROLE_COLUMNS = FUNCTIONAL_ROLES.map((r) => ROLE_LABELS[r])

const restriction = (id: string, module: string, reason: string, kind: 'procedure' | 'field' = 'procedure') =>
  ({ id, kind, target: id, module, actions: ['write'], reason })

export const sellerPermissions: EffectivePermissions = {
  email: 'seller@amnex.com', roles: ['sales'], systemAdmin: false,
  notes: ["Edit rights limited to own or assigned rows depend on each row's owner or assignment, so a module level cannot show them without a row: see the scoped entries."],
  modules: [
    { module: 'opp.pipeline', label: 'Pipeline rows', group: 'Opportunity', level: 'R', sets: [], create: false, delete: false, restrictions: [],
      scoped: [{ role: 'sales', scope: 'own', level: 'W', sets: [], create: true, delete: false }] },
    { module: 'com.skus', label: 'SKU catalog & BOM', group: 'Commercial', level: 'N', sets: [], create: false, delete: false, scoped: [], restrictions: [] },
    { module: 'admin.access', label: 'Role & Access Management', group: 'Admin', level: 'N', sets: [], create: false, delete: false, scoped: [], restrictions: [] },
  ],
} as unknown as EffectivePermissions

export const itPermissions: EffectivePermissions = {
  email: 'it@amnex.com', roles: ['it'], systemAdmin: false, notes: [],
  modules: [
    { module: 'admin.access', label: 'Role & Access Management', group: 'Admin', level: 'W', sets: [], create: true, delete: true, scoped: [], restrictedTo: 'System Admin',
      restrictions: [restriction('access.setOverride', 'admin.access', 'Role overrides decide who can see and change business data, so only a System Admin can create or change them.')] },
    { module: 'team.org', label: 'Company Org Structure', group: 'Teams', level: 'R', sets: [], create: false, delete: false, scoped: [],
      restrictions: [restriction('orgPeople.update#email', 'team.org', "An org person's email is what derives their role, so only a System Admin can change it.", 'field')] },
    { module: 'com.skus', label: 'SKU catalog & BOM', group: 'Commercial', level: 'P', sets: ['F1'], create: false, delete: false, scoped: [], restrictions: [] },
  ],
} as unknown as EffectivePermissions

export const rootPermissions: EffectivePermissions = {
  email: 'root@amnex.com', roles: ['system_admin'], systemAdmin: true,
  notes: ['System Admin is unrestricted: every module and every field. It comes only from the protected admin allow-list, never from an override.'],
  modules: [
    { module: 'admin.access', label: 'Role & Access Management', group: 'Admin', level: 'W', sets: [], create: true, delete: true, scoped: [], restrictions: [] },
  ],
} as unknown as EffectivePermissions

export const unmatchedFixture: UnmatchedOverride[] = [
  { id: 'u1', email: 'ghost@amnex.com', role: 'finance', effect: 'grant', reason: 'Covering for payroll', createdBy: 'root@amnex.com', createdAt: '2026-10-01T10:30:00.000Z' },
  { id: 'u2', email: 'gone@amnex.com', role: 'legal', effect: 'revoke', reason: 'Left the company', createdBy: 'it@amnex.com', createdAt: '2026-09-20T08:00:00.000Z' },
] as UnmatchedOverride[]

export const historyFixture: OverrideHistoryRow[] = [
  { id: 'h3', entityType: 'role_override', entityId: 'ghost@amnex.com|finance', field: 'effect', oldValue: 'grant', newValue: '', reason: 'No longer needed', action: 'remove', changedAt: '2026-10-03T09:00:00.000Z', changedBy: 'root@amnex.com', email: 'ghost@amnex.com', role: 'finance' },
  { id: 'h2', entityType: 'role_override', entityId: 'ghost@amnex.com|finance', field: 'effect', oldValue: 'revoke', newValue: 'grant', reason: 'Covering for payroll', action: 'update', changedAt: '2026-10-02T09:00:00.000Z', changedBy: 'root@amnex.com', email: 'ghost@amnex.com', role: 'finance' },
  { id: 'h1', entityType: 'role_override', entityId: 'ghost@amnex.com|finance', field: 'effect', oldValue: '', newValue: 'revoke', reason: 'Initial hold', action: 'create', changedAt: '2026-10-01T09:00:00.000Z', changedBy: 'it@amnex.com', email: 'ghost@amnex.com', role: 'finance' },
  { id: 'h0', entityType: 'role_override', entityId: 'ghost@amnex.com|finance', field: 'reason', oldValue: 'Initial hold', newValue: 'Covering for payroll', reason: 'Covering for payroll', action: 'update', changedAt: '2026-10-02T09:00:00.000Z', changedBy: 'root@amnex.com', email: 'ghost@amnex.com', role: 'finance' },
] as OverrideHistoryRow[]

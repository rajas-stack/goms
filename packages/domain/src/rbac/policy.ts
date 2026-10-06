import { W_ONLY_ATOMS } from './atoms.js'
import { FUNCTIONAL_ROLES, ROLES, type Grant, type Level, type Role, type Scope } from './types.js'

export const MODULES = [
  { key: 'opp.bidTracker', label: 'Bid Tracker rows', group: 'Opportunity' },
  { key: 'opp.pipeline', label: 'Pipeline rows', group: 'Opportunity' },
  { key: 'opp.campaign', label: 'Campaign rows', group: 'Opportunity' },
  { key: 'opp.master', label: 'Master Grid', group: 'Opportunity' },
  { key: 'bid.milestones', label: 'Milestones & dates', group: 'Opportunity' },
  { key: 'bid.corrigenda', label: 'Corrigenda', group: 'Opportunity' },
  { key: 'bid.documents', label: 'Tender documents', group: 'Opportunity' },
  { key: 'bid.protected', label: 'Protected values', group: 'Opportunity' },
  { key: 'bid.columns', label: 'Grid columns', group: 'Opportunity' },
  { key: 'am.contacts', label: 'People & Contacts', group: 'Account Mapping' },
  { key: 'am.departments', label: 'Customer Departments & Offices', group: 'Account Mapping' },
  { key: 'am.geography', label: 'Geography', group: 'Account Mapping' },
  { key: 'am.customers', label: 'Customers', group: 'Account Mapping' },
  { key: 'am.meetings', label: 'Meetings', group: 'Account Mapping' },
  { key: 'am.followUps', label: 'Follow-ups & Action Queue', group: 'Account Mapping' },
  { key: 'am.ownership', label: 'Ownership assignments', group: 'Account Mapping' },
  { key: 'team.sales', label: 'Sales Team', group: 'Teams' },
  { key: 'team.org', label: 'Company Org Structure', group: 'Teams' },
  { key: 'com.masters', label: 'Commercial reference masters', group: 'Commercial' },
  { key: 'com.approvalMatrix', label: 'Approval Matrix', group: 'Commercial' },
  { key: 'com.skus', label: 'SKU catalog & BOM', group: 'Commercial' },
  { key: 'com.boqs', label: 'BOQs & proposals', group: 'Commercial' },
  { key: 'an.operational', label: 'Operational analytics', group: 'Analytics' },
  { key: 'an.financial', label: 'Financial analytics', group: 'Analytics' },
  { key: 'admin.access', label: 'Role & Access Management', group: 'Admin' },
  { key: 'admin.audit', label: 'Audit Logs', group: 'Admin' },
] as const

export type ModuleKey = (typeof MODULES)[number]['key']
/** The Master Grid is derived: it has no grant and no authorization path of its own. */
export type PolicyModuleKey = Exclude<ModuleKey, 'opp.master'>

export function moduleLabel(key: ModuleKey): string {
  return MODULES.find((m) => m.key === key)?.label ?? key
}

/** Named partial sets (spec §6.2). Atoms are defined by the maps in atoms.ts / the registry. */
export const FIELD_SETS: Record<string, readonly string[]> = {
  S1: ['opp.client', 'opp.value', 'opp.emd', 'opp.teamSales', 'bid.nextAction', 'bid.custom'],
  P1: ['bid.nextAction', 'bid.custom'],
  L1: ['bid.nextAction', 'bid.custom'],
  X1: ['bid.decision'],
  L2: ['corrigendum.review'],
  DOC1: ['doc.upload'],
  B1: ['ownership.bidEntity'],
  S2: ['sales.ownProfile'],
  F1: ['sku.costs', 'sku.floor', 'sku.tax'],
  F2: ['master.taxClasses', 'master.currencies'],
  X2: ['boq.approve'],
}

/** Role-derivation departments (spec §3.2). Finance, IT and Delivery are override-only. */
export const DERIVED_ROLE_DEPARTMENTS = {
  presales: 'Pre-Sales', bid: 'Bid Management', legal: 'Legal', cxo: 'Leadership',
} as const

/** `sales_persons.status` values that derive the Sales role (plan gap A6). `resigned` and `inactive` do not. */
export const SALES_ROLE_STATUSES = ['active', 'onLeave'] as const

/** Modules with no create/delete operation: System Admin is `W` on them but holds no create/delete grant, and the
 *  audit trail stays append-only (spec §3.4). */
export const SYSTEM_ADMIN_VIEW_ONLY_MODULES: readonly PolicyModuleKey[] = ['an.operational', 'an.financial', 'admin.audit']

type Row = readonly [string, string, string, string, string, string, string, string]

/** Cell grammar: LEVEL[/SCOPE[/SETS]] — columns in FUNCTIONAL_ROLES order:
 *  sales, presales, bid, legal, cxo, delivery, it, finance. Scope defaults to `all`.
 *  System Admin has no column: buildGrants gives it W·all everywhere (spec §3.4). */
const CELLS: Record<PolicyModuleKey, Row> = {
  'opp.bidTracker':     ['P/own/S1', 'P/asg/P1', 'W', 'P/asg/L1', 'P/all/X1', 'R', 'R', 'R'],
  'opp.pipeline':       ['W/own', 'P/asg/P1', 'R', 'R', 'R', 'R', 'R', 'R'],
  'opp.campaign':       ['W/own', 'R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'bid.milestones':     ['R', 'R', 'W', 'R', 'R', 'R', 'R', 'R'],
  'bid.corrigenda':     ['R', 'R', 'W', 'P/all/L2', 'R', 'R', 'R', 'R'],
  'bid.documents':      ['R', 'P/asg/DOC1', 'W', 'P/asg/DOC1', 'R', 'R', 'N', 'R'],
  'bid.protected':      ['R', 'R', 'W', 'R', 'R', 'R', 'R', 'R'],
  'bid.columns':        ['R', 'R', 'W', 'R', 'R', 'R', 'W', 'R'],
  'am.contacts':        ['W', 'R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'am.departments':     ['W', 'R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'am.geography':       ['R', 'R', 'R', 'R', 'R', 'R', 'W', 'R'],
  'am.customers':       ['N', 'N', 'N', 'N', 'N', 'N', 'R', 'N'],
  'am.meetings':        ['W/own', 'R', 'R', 'N', 'R', 'R', 'N', 'N'],
  'am.followUps':       ['W/own', 'R', 'R', 'R', 'R', 'R', 'N', 'N'],
  'am.ownership':       ['W/own', 'R', 'P/all/B1', 'N', 'W', 'N', 'R', 'N'],
  'team.sales':         ['P/own/S2', 'R', 'R', 'N', 'W', 'N', 'R', 'N'],
  'team.org':           ['R', 'R', 'R', 'R', 'W', 'R', 'R', 'R'],
  'com.masters':        ['R', 'W', 'R', 'N', 'R', 'N', 'N', 'P/all/F2'],
  'com.approvalMatrix': ['N', 'R', 'N', 'N', 'W', 'N', 'N', 'R'],
  'com.skus':           ['R', 'W', 'N', 'N', 'R', 'N', 'N', 'P/all/F1'],
  'com.boqs':           ['R', 'W', 'R', 'N', 'P/all/X2', 'N', 'N', 'R'],
  'an.operational':     ['R', 'R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'an.financial':       ['N', 'N', 'N', 'N', 'R', 'N', 'N', 'R'],
  'admin.access':       ['N', 'N', 'N', 'N', 'R', 'N', 'W', 'N'],
  'admin.audit':        ['N', 'N', 'N', 'N', 'R', 'N', 'R', 'N'],
}

/** The Create / Delete columns of spec §10. A delete is still limited to rows inside the grant's write scope. */
const CREATE_DELETE: Record<PolicyModuleKey, { create: readonly Role[]; delete: readonly Role[] }> = {
  'opp.bidTracker':     { create: ['sales', 'bid'], delete: ['bid'] },
  'opp.pipeline':       { create: ['sales'], delete: ['bid'] },
  'opp.campaign':       { create: ['sales'], delete: ['bid'] },
  'bid.milestones':     { create: ['bid'], delete: ['bid'] },
  'bid.corrigenda':     { create: ['bid'], delete: ['bid'] },
  'bid.documents':      { create: ['bid', 'presales', 'legal'], delete: ['bid'] },
  'bid.protected':      { create: ['bid'], delete: ['bid'] },
  'bid.columns':        { create: ['bid', 'it'], delete: ['bid', 'it'] },
  'am.contacts':        { create: ['sales'], delete: ['it'] },
  'am.departments':     { create: ['sales'], delete: ['it'] },
  'am.geography':       { create: ['it'], delete: ['it'] },
  'am.customers':       { create: [], delete: [] },
  'am.meetings':        { create: ['sales'], delete: ['sales'] },
  'am.followUps':       { create: ['sales'], delete: ['sales'] },
  'am.ownership':       { create: ['sales', 'bid', 'cxo'], delete: ['sales', 'bid', 'cxo'] },
  'team.sales':         { create: ['cxo', 'it'], delete: ['cxo', 'it'] },
  'team.org':           { create: ['cxo'], delete: ['cxo'] },
  'com.masters':        { create: ['presales'], delete: ['presales'] },
  'com.approvalMatrix': { create: ['cxo'], delete: ['cxo'] },
  'com.skus':           { create: ['presales'], delete: ['presales'] },
  'com.boqs':           { create: ['presales'], delete: ['presales'] },
  'an.operational':     { create: [], delete: [] },
  'an.financial':       { create: [], delete: [] },
  'admin.access':       { create: ['it'], delete: ['it'] },
  'admin.audit':        { create: [], delete: [] },
}

function parseCell(cell: string): Pick<Grant, 'level' | 'scope' | 'sets'> {
  const [level, scope = 'all', sets = ''] = cell.split('/')
  return { level: level as Level, scope: scope as Scope, sets: sets ? sets.split(',') : [] }
}

function buildGrants(): Record<PolicyModuleKey, Record<Role, Grant>> {
  const out = {} as Record<PolicyModuleKey, Record<Role, Grant>>
  for (const module of Object.keys(CELLS) as PolicyModuleKey[]) {
    const byRole = {} as Record<Role, Grant>
    FUNCTIONAL_ROLES.forEach((role, i) => {
      byRole[role] = {
        ...parseCell(CELLS[module][i]),
        create: CREATE_DELETE[module].create.includes(role),
        delete: CREATE_DELETE[module].delete.includes(role),
      }
    })
    const operable = !SYSTEM_ADMIN_VIEW_ONLY_MODULES.includes(module)
    byRole.system_admin = { level: 'W', scope: 'all', sets: [], create: operable, delete: operable }
    out[module] = byRole
  }
  return out
}

export const GRANTS: Record<PolicyModuleKey, Record<Role, Grant>> = buildGrants()

export function grantFor(module: PolicyModuleKey, role: Role): Grant {
  return GRANTS[module][role]
}

/** Structural invariants; returns human-readable problems (empty = valid). Run by the test suite. */
export function validatePolicy(): string[] {
  const problems: string[] = []
  for (const module of Object.keys(GRANTS) as PolicyModuleKey[]) {
    for (const role of ROLES) {
      const g = GRANTS[module][role]
      const at = `${module}/${role}`
      if (!['N', 'R', 'P', 'W'].includes(g.level)) problems.push(`${at}: bad level ${g.level}`)
      if (g.level === 'P' && g.sets.length === 0) problems.push(`${at}: P needs at least one set`)
      if (g.level !== 'P' && g.sets.length > 0) problems.push(`${at}: only P may name sets`)
      for (const set of g.sets) if (!FIELD_SETS[set]) problems.push(`${at}: unknown set ${set}`)
      if (g.level === 'N' && (g.create || g.delete)) problems.push(`${at}: create/delete need level >= R`)
      if (g.scope === 'own' && role !== 'sales') problems.push(`${at}: only Sales can be scoped to own`)
      if (g.scope === 'asg' && !['presales', 'legal', 'bid'].includes(role)) problems.push(`${at}: asg is for Pre-sales/Legal/Bid`)
      if (g.scope !== 'all' && g.level !== 'P' && g.level !== 'W') problems.push(`${at}: a scope only applies to P/W`)
      if (role === 'delivery' && (g.level === 'P' || g.level === 'W' || g.scope !== 'all' || g.create || g.delete)) {
        problems.push(`${at}: Delivery is read-only in v1`)
      }
      if (role === 'system_admin') {
        const viewOnly = SYSTEM_ADMIN_VIEW_ONLY_MODULES.includes(module)
        if (g.level !== 'W' || g.scope !== 'all' || g.sets.length > 0) problems.push(`${at}: System Admin must be W on scope all`)
        if (g.create === viewOnly || g.delete === viewOnly) problems.push(`${at}: System Admin create/delete must be ${!viewOnly}`)
      }
    }
  }
  for (const [name, atoms] of Object.entries(FIELD_SETS)) {
    for (const atom of atoms) if (W_ONLY_ATOMS.includes(atom)) problems.push(`set ${name}: ${atom} is W-only`)
  }
  return problems
}

import { EXCLUSIVE_ATOMS } from './atoms.js'
import { FIELD_SETS, GRANTS, type PolicyModuleKey } from './policy.js'
import { maxLevel, type Level, type Role, type Scope, type ScopeFacts, type UserFacts } from './types.js'

export interface Access {
  level: Level
  /** A `W` grant applies: every atom except the exclusive ones. */
  all: boolean
  /** Atoms granted by applicable `P` sets. */
  atoms: ReadonlySet<string>
  create: boolean
  delete: boolean
}

const NO_ACCESS: Access = { level: 'N', all: false, atoms: new Set(), create: false, delete: false }
const READ_ONLY: Access = { level: 'R', all: false, atoms: new Set(), create: false, delete: false }

/** Reading the key module grants read-only access to the listed modules (gap A2): BOQ screens look up SKUs and
 *  reference masters by id. The approval matrix is deliberately not implied. */
export const IMPLIED_READS: Partial<Record<PolicyModuleKey, readonly PolicyModuleKey[]>> = {
  'com.boqs': ['com.skus', 'com.masters'],
}

export function inScope(scope: Scope, role: Role, user: UserFacts, row: ScopeFacts): boolean {
  if (scope === 'all') return true
  if (scope === 'own') {
    if (role !== 'sales') return false
    if (user.salesPersonId && row.salesOwnerIds.includes(user.salesPersonId)) return true
    return row.createdBy !== null && row.createdBy === user.email.trim().toLowerCase()
  }
  // asg: the row's slot for this role must be one of the caller's own team-member ids
  if (role === 'presales') return !!row.assigned.presales && user.teamMemberIds.presales.includes(row.assigned.presales)
  if (role === 'legal') return !!row.assigned.legal && user.teamMemberIds.legal.includes(row.assigned.legal)
  if (role === 'bid') return !!row.assigned.bid && user.teamMemberIds.bid.includes(row.assigned.bid)
  return false
}

function rawAccess(user: UserFacts, module: PolicyModuleKey, row?: ScopeFacts): Access {
  let level: Level = 'N'
  let all = false
  const atoms = new Set<string>()
  let create = false
  let del = false
  for (const role of user.roles) {
    const grant = GRANTS[module][role]
    if (grant.level === 'N') continue
    level = maxLevel(level, 'R') // there is no row-level read scoping
    // Without row facts only scope-all grants can be shown to apply to a specific row.
    const applicable = row ? inScope(grant.scope, role, user, row) : grant.scope === 'all'
    if (applicable && (grant.level === 'P' || grant.level === 'W')) {
      level = maxLevel(level, grant.level)
      if (grant.level === 'W') all = true
      else for (const set of grant.sets) for (const atom of FIELD_SETS[set]) atoms.add(atom)
    }
    if (grant.create && (row ? applicable : true)) create = true
    if (grant.delete && applicable) del = true
  }
  return { level, all, atoms, create, delete: del }
}

/** What `user` may do in `module`, optionally for one specific row. */
export function accessFor(user: UserFacts, module: PolicyModuleKey, row?: ScopeFacts): Access {
  if (user.roles.length === 0) return module === 'am.geography' ? READ_ONLY : NO_ACCESS // baseline
  const own = rawAccess(user, module, row)
  if (own.level !== 'N') return own
  for (const [source, targets] of Object.entries(IMPLIED_READS)) {
    if (targets?.includes(module) && rawAccess(user, source as PolicyModuleKey).level !== 'N') return READ_ONLY
  }
  return own
}

/** May this access edit `atom`? `W` covers everything except exclusive atoms, which only an explicit set grants. */
export function allows(access: Access, atom: string): boolean {
  return access.atoms.has(atom) || (access.all && !EXCLUSIVE_ATOMS.has(atom))
}

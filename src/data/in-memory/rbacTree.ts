import {
  RBAC_NODE_MANIFEST, applyGrantChanges, expandDynamicNodes, fromGrantMap, normalizeRoleInput, normalizeTemplateName, resolveMyAccess,
  subjectKey, syncNodeList, toGrantMap,
  type ApplyTemplateInput, type RbacCustomRole, type RbacGrant, type RbacGrantChange, type RbacGrantMap, type RbacMyAccess, type RbacNode,
  type RbacRoleInput, type RbacSubjectConfig, type RbacSubjectRef, type RbacSubjects, type RbacSyncResult, type RbacTemplate,
  type RbacTemplateInput, type SavedViewLike, type RbacLinkableRef,
} from '@goms/domain'

/** The permission tree as the local (no-server) store keeps it, inside the persisted snapshot. Every function here is pure:
 *  it returns a new state and never modifies its input. */
export interface StoredGrant extends RbacGrant { subject: string }
interface StoredTemplate { id: string; name: string; description: string; createdAt: string; updatedAt: string }
export interface RbacLocalState {
  nodes: RbacNode[]
  grants: StoredGrant[]
  roles: RbacCustomRole[]
  templates: StoredTemplate[]
  /** subject key → template id (linked mode). */
  links: Record<string, string>
}

export const emptyRbacState = (): RbacLocalState => ({ nodes: [], grants: [], roles: [], templates: [], links: {} })

const now = () => new Date().toISOString()
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

export function syncLocalNodes(state: RbacLocalState): { state: RbacLocalState; result: RbacSyncResult } {
  const { nodes, result } = syncNodeList(state.nodes, RBAC_NODE_MANIFEST)
  return { state: { ...state, nodes }, result }
}

/** Synced nodes plus the saved views of each sheet's Views node. */
export const listLocalNodes = (state: RbacLocalState, views: readonly SavedViewLike[]): RbacNode[] =>
  expandDynamicNodes(syncLocalNodes(state).state.nodes, views)

export const grantsOf = (state: RbacLocalState, subject: RbacSubjectRef): RbacGrantMap =>
  toGrantMap(state.grants.filter((g) => g.subject === subjectKey(subject)))

export const getLocalConfig = (state: RbacLocalState, subject: RbacSubjectRef): RbacSubjectConfig => ({
  subject, grants: fromGrantMap(grantsOf(state, subject)), templateId: state.links[subjectKey(subject)] ?? null,
})

const withGrants = (state: RbacLocalState, subject: RbacSubjectRef, map: RbacGrantMap): RbacLocalState => {
  const key = subjectKey(subject)
  return { ...state, grants: [...state.grants.filter((g) => g.subject !== key), ...fromGrantMap(map).map((g) => ({ ...g, subject: key }))] }
}

export const setLocalConfig = (state: RbacLocalState, subject: RbacSubjectRef, changes: readonly RbacGrantChange[]): RbacLocalState =>
  withGrants(state, subject, applyGrantChanges(grantsOf(state, subject), changes))

export function localSubjects(state: RbacLocalState): RbacSubjects {
  const users = new Set<string>()
  for (const g of state.grants) if (g.subject.startsWith('user:')) users.add(g.subject.slice(5))
  for (const key of Object.keys(state.links)) if (key.startsWith('user:')) users.add(key.slice(5))
  const templates: RbacTemplate[] = state.templates.map((t) => ({
    ...t,
    grantCount: state.grants.filter((g) => g.subject === `template:${t.id}`).length,
    links: Object.entries(state.links).filter(([, id]) => id === t.id).map(([key]) => {
      const [type, ...rest] = key.split(':')
      return { type: type as RbacSubjectRef['type'], id: rest.join(':') }
    }),
  }))
  return { customRoles: state.roles.map((r) => ({ ...r, members: [...r.members] })), templates, users: [...users].sort(), links: { ...state.links } }
}

export function createLocalRole(state: RbacLocalState, input: RbacRoleInput): { state: RbacLocalState; role: RbacCustomRole } {
  const clean = normalizeRoleInput(input)
  const role: RbacCustomRole = { id: `custom:${newId()}`, ...clean, createdAt: now(), updatedAt: now() }
  return { state: { ...state, roles: [...state.roles, role] }, role }
}

export function updateLocalRole(state: RbacLocalState, id: string, input: RbacRoleInput): RbacLocalState {
  const clean = normalizeRoleInput(input)
  if (!state.roles.some((r) => r.id === id)) throw new Error('That role no longer exists.')
  return { ...state, roles: state.roles.map((r) => (r.id === id ? { ...r, ...clean, updatedAt: now() } : r)) }
}

/** Removes the role, its grants and its template link. */
export function deleteLocalRole(state: RbacLocalState, id: string): RbacLocalState {
  const key = subjectKey({ type: 'role', id })
  const { [key]: _gone, ...links } = state.links
  return { ...state, roles: state.roles.filter((r) => r.id !== id), grants: state.grants.filter((g) => g.subject !== key), links }
}

/** A new template, optionally copied from a subject's own grants layered over the template it follows. */
export function createLocalTemplate(state: RbacLocalState, input: RbacTemplateInput): { state: RbacLocalState; id: string } {
  const name = normalizeTemplateName(input.name)
  if (state.templates.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new Error(`A template named "${name}" already exists.`)
  const id = newId()
  const template = { id, name, description: (input.description ?? '').trim(), createdAt: now(), updatedAt: now() }
  let grants: RbacGrantMap = {}
  if (input.from) {
    const linked = state.links[subjectKey(input.from)]
    grants = { ...(linked ? grantsOf(state, { type: 'template', id: linked }) : {}) }
    grants = applyGrantChanges(grants, getLocalConfig(state, input.from).grants.map((g) => ({ nodeId: g.nodeId, action: g.action, value: g.effect })))
  }
  return { state: withGrants({ ...state, templates: [...state.templates, template] }, { type: 'template', id }, grants), id }
}

export function updateLocalTemplate(state: RbacLocalState, id: string, input: { name: string; description?: string }): RbacLocalState {
  const name = normalizeTemplateName(input.name)
  if (state.templates.some((t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) throw new Error(`A template named "${name}" already exists.`)
  return { ...state, templates: state.templates.map((t) => (t.id === id ? { ...t, name, description: (input.description ?? t.description).trim(), updatedAt: now() } : t)) }
}

export function duplicateLocalTemplate(state: RbacLocalState, id: string): { state: RbacLocalState; id: string } {
  const source = state.templates.find((t) => t.id === id)
  if (!source) throw new Error('That template no longer exists.')
  let name = `${source.name} (copy)`
  for (let i = 2; state.templates.some((t) => t.name === name); i++) name = `${source.name} (copy ${i})`
  const created = createLocalTemplate(state, { name, description: source.description })
  return { state: withGrants(created.state, { type: 'template', id: created.id }, grantsOf(state, { type: 'template', id })), id: created.id }
}

export function deleteLocalTemplate(state: RbacLocalState, id: string): RbacLocalState {
  const key = subjectKey({ type: 'template', id })
  return {
    ...state, templates: state.templates.filter((t) => t.id !== id), grants: state.grants.filter((g) => g.subject !== key),
    links: Object.fromEntries(Object.entries(state.links).filter(([, t]) => t !== id)),
  }
}

/** Links every subject to the template; `replace` also clears their own overrides so the template fully applies. */
export function applyLocalTemplate(state: RbacLocalState, input: ApplyTemplateInput): RbacLocalState {
  if (!state.templates.some((t) => t.id === input.templateId)) throw new Error('That template no longer exists.')
  return input.subjects.reduce<RbacLocalState>((acc, subject) => {
    const linked = { ...acc, links: { ...acc.links, [subjectKey(subject)]: input.templateId } }
    return input.mode === 'replace' ? withGrants(linked, subject, {}) : linked
  }, state)
}

export function unlinkLocalTemplate(state: RbacLocalState, subject: RbacLinkableRef): RbacLocalState {
  const { [subjectKey(subject)]: _gone, ...links } = state.links
  return { ...state, links }
}

/** What the local user may do. The local store knows no functional roles: custom-role membership, user overrides and
 *  linked templates apply. With no email (not signed in), only grants of roles with no member list cannot apply: open. */
export function localMyAccess(state: RbacLocalState, views: readonly SavedViewLike[], email: string | null, functionalRoles: readonly string[] = []): RbacMyAccess {
  if (!email) return { configured: false, allowed: {} }
  const mail = email.toLowerCase()
  const roleIds = [...functionalRoles, ...state.roles.filter((r) => r.members.includes(mail)).map((r) => r.id)]
  const roleRefs = roleIds.map((id) => ({ type: 'role' as const, id }))
  const userRef = { type: 'user' as const, id: mail }
  const templateIds = [...new Set([userRef, ...roleRefs].map((s) => state.links[subjectKey(s)]).filter((t): t is string => !!t))]
  return resolveMyAccess({
    nodes: listLocalNodes(state, views),
    user: grantsOf(state, userRef),
    roles: roleRefs.map((r) => grantsOf(state, r)),
    templates: templateIds.map((id) => grantsOf(state, { type: 'template', id })),
  })
}

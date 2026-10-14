/** The UI permission tree (docs/superpowers/specs/2026-10-14-dynamic-rbac-design.md). It narrows what the server policy
 *  (FUNCTIONAL_ROLES x MODULES) already allows; it never widens it. */

export const RBAC_NODE_KINDS = ['module', 'page', 'tab', 'subtab', 'section', 'view', 'action-area'] as const
export type RbacNodeKind = (typeof RBAC_NODE_KINDS)[number]

export const RBAC_ACTIONS = ['view', 'create', 'edit', 'delete', 'download', 'manage'] as const
export type RbacAction = (typeof RBAC_ACTIONS)[number]

export const RBAC_ACTION_LABELS: Record<RbacAction, string> = {
  view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', download: 'Download', manage: 'Manage',
}

export const RBAC_KIND_LABELS: Record<RbacNodeKind, string> = {
  module: 'Module', page: 'Page', tab: 'Tab', subtab: 'Sub-tab', section: 'Section', view: 'View', 'action-area': 'Action area',
}

/** Containers act as cascading defaults for everything below them, so every action applies; a saved view can only be
 *  seen, edited or deleted. A declaration can always name its own list. */
export const DEFAULT_NODE_ACTIONS: Record<RbacNodeKind, readonly RbacAction[]> = {
  module: RBAC_ACTIONS, page: RBAC_ACTIONS, tab: RBAC_ACTIONS, subtab: RBAC_ACTIONS, section: RBAC_ACTIONS,
  view: ['view', 'edit', 'delete'], 'action-area': RBAC_ACTIONS,
}

export type RbacEffect = 'allow' | 'deny'
/** A cell in the editor: `inherit` is the absence of a stored grant. */
export type RbacCellValue = RbacEffect | 'inherit'

/** Children generated at read time from data (one node per saved view of `sheet`). */
export interface RbacNodeDynamic { source: 'savedViews'; sheet: string }

/** A node as declared in code and recorded in the generated manifest. */
export interface RbacNodeDef {
  /** Dotted path: `parentId + '.' + key`. Keys never contain dots, so the parent is derivable from the id. */
  id: string
  parentId: string | null
  label: string
  kind: RbacNodeKind
  actions: RbacAction[]
  /** Position among its siblings. */
  order: number
  dynamic?: RbacNodeDynamic
}

/** A node as the API / local store serves it. */
export interface RbacNode extends RbacNodeDef {
  /** No longer declared by the code: kept (greyed) with its grants, never deleted. */
  retired: boolean
  /** Generated from data (saved views), not from the manifest. */
  runtime: boolean
}

export type RbacSubjectType = 'role' | 'user' | 'template'
export interface RbacSubjectRef { type: RbacSubjectType; id: string }

export interface RbacGrant { nodeId: string; action: RbacAction; effect: RbacEffect }
/** nodeId → action → explicit effect. A missing entry is `inherit`. */
export type RbacGrantMap = Readonly<Record<string, Partial<Record<RbacAction, RbacEffect>>>>

/** A subject's own explicit grants plus the template it follows (linked mode), if any. */
export interface RbacSubjectConfig {
  subject: RbacSubjectRef
  grants: RbacGrant[]
  templateId: string | null
}

/** Change to one cell; `inherit` removes the stored grant. */
export interface RbacGrantChange { nodeId: string; action: RbacAction; value: RbacCellValue }

export interface RbacCustomRole {
  /** `custom:<uuid>` — the subject id used in grants and template links. */
  id: string
  label: string
  description: string
  members: string[]
  createdAt: string
  updatedAt: string
}

export interface RbacTemplate {
  id: string
  name: string
  description: string
  grantCount: number
  /** Roles and users that follow this template (linked mode). */
  links: RbacSubjectRef[]
  createdAt: string
  updatedAt: string
}

export type ApplyTemplateMode = 'keep' | 'replace'

/** Bit per action in RBAC_ACTIONS order (view = 1, create = 2, …). */
export type RbacActionMask = number

/** What the browser needs to enforce the tree for the signed-in user. */
export interface RbacMyAccess {
  /** False when no grant applies to this user (or they are a System Admin): everything is allowed. */
  configured: boolean
  /** Allowed actions per known node (bit mask). Nodes not listed resolve through their nearest listed ancestor. */
  allowed: Record<string, RbacActionMask>
}

export interface RbacAuditEntry {
  id: string
  subject: string
  field: string
  oldValue: string
  newValue: string
  action: string
  reason: string
  changedBy: string | null
  changedAt: string
}

/** Grant subject id for a functional or custom role / user email / template. */
export const subjectKey = (s: RbacSubjectRef): string => `${s.type}:${s.id}`

/** Everything the editor's subject picker lists. Functional roles come from FUNCTIONAL_ROLES. */
export interface RbacSubjects {
  customRoles: RbacCustomRole[]
  templates: RbacTemplate[]
  /** Emails that have their own overrides or a linked template. */
  users: string[]
  /** Subject key (`role:sales`, `user:a@b`) → linked template id. */
  links: Record<string, string>
}

export interface RbacSyncResult { added: number; updated: number; retired: number; restored: number }

export interface RbacRoleInput { label: string; description?: string; members?: string[] }
export interface RbacTemplateInput { name: string; description?: string; from?: RbacSubjectRef | null }
/** A subject that can follow a template (templates themselves cannot). */
export interface RbacLinkableRef { type: 'role' | 'user'; id: string }
export interface ApplyTemplateInput { templateId: string; subjects: RbacLinkableRef[]; mode: ApplyTemplateMode }

export const RBAC_LIMITS = { label: 80, description: 500, members: 500, changes: 5000, subjects: 200 } as const

/** Trims and validates a custom role; throws a user-facing message. */
export function normalizeRoleInput(input: RbacRoleInput): Required<RbacRoleInput> {
  const label = input.label.trim()
  if (!label || label.length > RBAC_LIMITS.label) throw new Error(`A role name is required (at most ${RBAC_LIMITS.label} characters).`)
  const description = (input.description ?? '').trim().slice(0, RBAC_LIMITS.description)
  const members = [...new Set((input.members ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean))]
  const bad = members.find((m) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m))
  if (bad) throw new Error(`"${bad}" is not an email address.`)
  if (members.length > RBAC_LIMITS.members) throw new Error(`A role can have at most ${RBAC_LIMITS.members} members.`)
  return { label, description, members }
}

export function normalizeTemplateName(name: string): string {
  const n = name.trim()
  if (!n || n.length > RBAC_LIMITS.label) throw new Error(`A template name is required (at most ${RBAC_LIMITS.label} characters).`)
  return n
}

export type Domain = 'geo' | 'org' | 'sales'
export type Status = 'active' | 'archived'

export interface NodeType {
  key: string
  domain: Domain
  label: string
  icon: string
  /** allowed child type keys; empty = any */
  childKeys: string[]
  level: number
}

export interface HierNode {
  id: string
  domain: Domain
  typeKey: string
  parentId: string | null
  /** state LGD code this node belongs under (org nodes are jurisdictioned to a state) */
  stateCode: number | null
  name: string
  code: string | null
  sortOrder: number
  metadata: Record<string, string>
  status: Status
}

/** Node types are DATA, not hardcoded enums. This registry seeds the initial
 *  set; admins can extend it. Nothing in the engine assumes these specific keys. */
const NODE_TYPES: NodeType[] = [
  { key: 'country', domain: 'geo', label: 'Country', icon: 'Globe', childKeys: ['state'], level: 0 },
  { key: 'state', domain: 'geo', label: 'State / UT', icon: 'Landmark', childKeys: ['district'], level: 1 },
  { key: 'district', domain: 'geo', label: 'District', icon: 'MapPin', childKeys: ['taluka'], level: 2 },
  { key: 'taluka', domain: 'geo', label: 'Taluka', icon: 'Map', childKeys: ['village'], level: 3 },
  { key: 'village', domain: 'geo', label: 'Village', icon: 'Home', childKeys: [], level: 4 },

  { key: 'department', domain: 'org', label: 'Department', icon: 'Building2', childKeys: ['branch', 'department'], level: 0 },
  { key: 'branch', domain: 'org', label: 'Branch', icon: 'GitBranch', childKeys: ['branch', 'division', 'office'], level: 1 },
  { key: 'division', domain: 'org', label: 'Division', icon: 'Layers', childKeys: ['office'], level: 2 },
  { key: 'office', domain: 'org', label: 'Office', icon: 'DoorOpen', childKeys: ['unit'], level: 3 },
  { key: 'unit', domain: 'org', label: 'Unit', icon: 'Boxes', childKeys: [], level: 4 },
]

export const NODE_TYPE_MAP: Record<string, NodeType> = Object.fromEntries(
  NODE_TYPES.map((t) => [t.key, t]),
)

/** Org node types an employee can be posted at (offices/units) — used for
 *  transfer targets. */
export const POSTING_TYPES = new Set(['department', 'branch', 'division', 'office', 'unit'])

function typesForDomain(domain: Domain): NodeType[] {
  return NODE_TYPES.filter((t) => t.domain === domain)
}

export function childTypesOf(typeKey: string): NodeType[] {
  const t = NODE_TYPE_MAP[typeKey]
  if (!t) return []
  const keys = t.childKeys.length ? t.childKeys : typesForDomain(t.domain).map((x) => x.key)
  return keys.map((k) => NODE_TYPE_MAP[k]).filter(Boolean)
}

/** Whether `childTypeKey` is a permitted child of `parentTypeKey`, per the
 *  registry's `childKeys` — the single rule createNode/moveNode/moveTargets/
 *  drag-and-drop all defer to, so a type's allowed children are only ever
 *  declared once. An empty `childKeys` means "any type in the domain" (see
 *  `NodeType.childKeys`'s doc comment), so an unrecognized/unrestricted
 *  parent type key permits any child. */
export function isValidChildType(parentTypeKey: string, childTypeKey: string): boolean {
  const allowed = NODE_TYPE_MAP[parentTypeKey]?.childKeys ?? []
  return allowed.length === 0 || allowed.includes(childTypeKey)
}

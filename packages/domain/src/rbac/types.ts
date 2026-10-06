export const ROLES = ['sales', 'presales', 'bid', 'legal', 'cxo', 'delivery', 'it', 'finance'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  sales: 'Sales', presales: 'Pre-sales', bid: 'Bid', legal: 'Legal', cxo: 'CXO', delivery: 'Delivery', it: 'IT', finance: 'Finance',
}

export type Level = 'N' | 'R' | 'P' | 'W'
export const LEVEL_ORDER: Record<Level, number> = { N: 0, R: 1, P: 2, W: 3 }
export const maxLevel = (a: Level, b: Level): Level => (LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b)

/** Write scope. `own` is Sales-only, `asg` is Pre-sales / Legal / Bid only (validated in policy.ts). */
export type Scope = 'all' | 'own' | 'asg'

export type RbacMode = 'off' | 'shadow' | 'enforce'

export interface Grant {
  level: Level
  scope: Scope
  /** Named partial sets (FIELD_SETS keys). Non-empty only for level `P`. */
  sets: readonly string[]
  create: boolean
  delete: boolean
}

/** Who is calling — resolved once per request on the server, and by `auth.me` for the UI. */
export interface UserFacts {
  email: string
  roles: readonly Role[]
  /** The caller's `sales_persons.id`, matched on official email. */
  salesPersonId: string | null
  /** The caller's `delivery_team_members.id`s, per team. */
  teamMemberIds: { presales: readonly string[]; legal: readonly string[]; bid: readonly string[] }
}

/** What makes a particular row `own` / `asg` for someone. */
export interface ScopeFacts {
  /** `sales_persons.id`s that make the row "own": effective owner, active delegate / solution lead, Geo/BU-sales. */
  salesOwnerIds: readonly string[]
  /** Lower-cased creator email, when the row records one. */
  createdBy: string | null
  /** The row's team-slot ids (`delivery_team_members.id`). */
  assigned: { presales: string | null; legal: string | null; bid: string | null }
}

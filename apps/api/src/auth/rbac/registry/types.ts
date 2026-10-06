import type { PolicyModuleKey, ScopeFacts, UserFacts } from '@goms/domain'

export type CheckAction = 'read' | 'create' | 'update' | 'delete'

export interface Check {
  module: PolicyModuleKey
  action: CheckAction
  /** update: the atoms the call touches. `undefined` = a generic write (needs W); `[]` = any write level. */
  atoms?: string[]
  /** The row being touched, when the module has own/asg scopes (or a parent row for a create). */
  row?: ScopeFacts
  /** read: passes if the user can read ANY of these modules (dependent reads, gap A4). */
  anyOf?: PolicyModuleKey[]
}

/** One authorization requirement. `null` = it does not apply to this input (e.g. no sheet move in the patch). */
export type Requirement = (raw: any, user: UserFacts) => Check | null | Promise<Check | null>

export interface PolicyEntry {
  /** All must pass (logical AND). Normally one; a cross-module procedure lists one per module. */
  requirements: Requirement[]
  /** Post-processes the response for this caller (SKU masking, search filtering, roster redaction). */
  mask?: (data: unknown, user: UserFacts) => unknown
  /** public: no checks (liveness). outside: governed elsewhere (Data Import). self: the caller's own identity. */
  kind?: 'public' | 'outside' | 'self'
}

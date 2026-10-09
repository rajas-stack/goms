import type { AmPolicyField } from './generated/engine.generated'

export type PolicyField = AmPolicyField
export type PolicyPage = { name: string; fields: PolicyField[] }
/** Shape of the generated RBAC policy (scripts/access-matrix/build.cjs). */
export type Policy = { source: string; sheet: string; teams: string[]; pages: PolicyPage[] }

// Types for the generated engine (engine.cjs inlined as engine.generated.js). Copied by build.cjs.
export type AmScope = 'C' | 'BU' | 'DEP' | 'MGR' | 'ASG' | 'OWN' | 'APPROVED' | 'META'
export type AmCell = { state: 0 | 1 | 2; scopes: AmScope[] }
export type AmPolicyField = { n: string; s: string; k: string; p: string[] }
export type AmEffective = { state: 0 | 1 | 2; readScopes: AmScope[]; editScopes: AmScope[]; scopes: AmScope[]; grantedBy: string[] }

export function amDecodeCell(str: string | undefined): AmCell
export function amCell(field: AmPolicyField | null | undefined, teamIdx: number, lvl: number): AmCell
export function amEffective(field: AmPolicyField | null | undefined, teams: string[], lvl: number, teamNames: string[]): AmEffective
export function amAccessForScope(eff: AmEffective, scope: AmScope): 0 | 1 | 2
export function amScopeLabel(scopes: AmScope[]): string
export function amLabelToScopes(label: string): AmScope[]
export function amLevelAllowed(team: string, lvl: number): boolean
export const AM_ALLOWED_LEVELS: Record<string, number[]>
export const AM_SCOPE_LABEL: Record<AmScope, string>
export const AM_SCOPE_BY_LETTER: Record<string, AmScope>

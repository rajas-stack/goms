import { amCell, amEffective, amLevelAllowed, amScopeLabel } from './generated/engine.generated'
import { POLICY } from './generated/policy.generated'
import type { PolicyField } from './policyTypes'

// Pure model behind the Access Matrix screen. Every permission comes from the generated policy through the
// generated engine; nothing here decides who may see or edit a field.

export const TEAMS = POLICY.teams
export const LEVELS: [string, string][] = [['L0', 'Management'], ['L1', 'CXO'], ['L2', 'BUH'], ['L3', 'Dept Leader'], ['L4', 'Manager'], ['L5', 'Associate']]
export const SCOPE_BY_LEVEL = ['Company', 'Company', 'BU', 'Department', 'Managed Team', 'Own']
export const SENS: Record<string, [string, string]> = {
  Low: ['Low', '#7A889B'], Medium: ['Medium', '#B07A2E'], High: ['High', '#B5505C'], 'Very High': ['Very High', '#9B2C3B'],
}
export const ICON: Record<string, string> = {
  'Opportunity': 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z',
  'Accounts Mapping': 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  'Commercial Calculator': 'M5 3h14v18H5zM8 7h8M8 12h2M12 12h2M8 16h2M12 16h2',
}
/** Scope choices in the dropdowns, in the design's order. */
export const SCOPE_OPTIONS = ['Own', 'Assigned', 'Own / Assigned', 'Managed Team', 'Department', 'BU', 'Company']
export const FIELD_SCOPE_OPTIONS = [...SCOPE_OPTIONS, 'Approved Handoff', 'Technical Metadata']

export interface MatrixField extends PolicyField { id: string }
export interface MatrixPage { id: string; name: string; fields: MatrixField[] }
/** Sections the screen leaves out for now, by page. This is display only: they stay in the generated policy and the
 *  workbook untouched, and the validator still checks them. Remove an entry here to bring a section back. */
export const HIDDEN_SECTIONS: Record<string, string[]> = { Opportunity: ['Master'] }
export const PAGES: MatrixPage[] = POLICY.pages.map((p) => ({
  id: p.name,
  name: p.name,
  fields: p.fields
    .filter((f) => !(HIDDEN_SECTIONS[p.name] ?? []).includes(f.s))
    .map((f, i) => ({ ...f, id: `${p.name}.${f.s}.${f.n}#${i}` })),
}))

export type Override = { view?: boolean; edit?: boolean; scope?: string }
export type Overrides = Record<string, Override>
export interface MatrixState {
  team: string
  lvl: number
  open: string | null
  mode: 'edit' | 'preview'
  ov: Overrides
  saved: Overrides
  /** Expanded field groups, keyed by groupKey(). Groups start collapsed; the key is the policy's own section name. */
  groups: Record<string, boolean>
}
export const initialState = (): MatrixState => ({ team: 'Delivery', lvl: 5, open: 'Opportunity', mode: 'edit', ov: {}, saved: {}, groups: {} })

/** Whether `team` may ever hold `lvl`. CXO is limited to L0 and L1; the rule lives in the generated engine, which also
 *  denies CXO L2-L5 whatever a policy cell says. The UI only reflects it: it is not the security boundary. */
export const levelAllowed = (team: string, lvl: number): boolean => amLevelAllowed(team, lvl)

/** The level to show for `team`: `lvl` itself when allowed, else the nearest allowed level at or below it (CXO L5 -> L1). */
function nearestAllowedLevel(team: string, lvl: number): number {
  for (let l = lvl; l >= 0; l--) if (levelAllowed(team, l)) return l
  for (let l = lvl + 1; l < LEVELS.length; l++) if (levelAllowed(team, l)) return l
  return lvl
}

/** Switching team never leaves an invalid level selected: switching to CXO from L2-L5 lands on L1. */
export const selectTeam = (state: MatrixState, team: string): MatrixState => ({ ...state, team, lvl: nearestAllowedLevel(team, state.lvl) })

/** Picking a level the team may not hold does nothing (the same state object comes back). */
export const selectLevel = (state: MatrixState, lvl: number): MatrixState => (levelAllowed(state.team, lvl) ? { ...state, lvl } : state)

/** Short explanation shown next to the level selectors, or null when the team may hold every level. */
export function levelRestrictionNote(team: string): string | null {
  const allowed = LEVELS.map((_, l) => l).filter((l) => levelAllowed(team, l)).map((l) => `L${l}`)
  if (allowed.length === LEVELS.length) return null
  const list = allowed.length > 1 ? `${allowed.slice(0, -1).join(', ')} and ${allowed[allowed.length - 1]}` : allowed[0]
  return `${team} access is restricted to ${list}.`
}

/** A field group is one section of the policy (the FINAL sheet's Section/Page column), within a page. */
export const groupKey = (pageId: string, section: string) => `${pageId}|${section}`

/** Teams whose grants are unioned for the person being shown. The editor shows one team; Preview as User can pass
 *  every active membership here because the engine is already additive. */
export const activeTeams = (team: string) => [team]

export function pageScope(state: MatrixState, team: string, lvl: number, pid: string): string {
  const o = state.ov[`${team}|${lvl}|${pid}|scope`]
  if (o && o.scope) return o.scope
  const n: Record<string, number> = {}
  const page = PAGES.find((p) => p.id === pid)!
  page.fields.forEach((f) => {
    const g = amEffective(f, activeTeams(team), lvl, TEAMS)
    if (g.state > 0 && !g.scopes.every((sc) => sc === 'APPROVED' || sc === 'META')) { const k = amScopeLabel(g.scopes); n[k] = (n[k] || 0) + 1 }
  })
  if (!Object.keys(n).length) {
    page.fields.forEach((f) => {
      const g = amEffective(f, activeTeams(team), lvl, TEAMS)
      if (g.state > 0) { const k = amScopeLabel(g.scopes); n[k] = (n[k] || 0) + 1 }
    })
  }
  const top = Object.keys(n).sort((x, y) => n[y] - n[x])[0]
  return top || SCOPE_BY_LEVEL[lvl]
}

export interface Eff {
  view: boolean; edit: boolean; scope: string; note: string; differs: boolean; ovScope: string; over: boolean; key: string; acc: 0 | 1 | 2
}
export function eff(state: MatrixState, team: string, lvl: number, f: MatrixField, pid: string): Eff {
  const g = amEffective(f, activeTeams(team), lvl, TEAMS)
  let view = g.state > 0
  let edit = g.state === 2
  const pdef = pageScope(state, team, lvl, pid)
  let scope = view ? amScopeLabel(g.scopes) : pdef
  let last = -1
  for (let l = 0; l < 6; l++) if (levelAllowed(team, l) && amCell(f, TEAMS.indexOf(team), l).state > 0) last = l
  let note = last < 0
    ? `Denied for ${team} at every level.`
    : !view
      ? `Denied for ${team} ${LEVELS[lvl][0]} — Read starts at ${LEVELS[last][0]} ${LEVELS[last][1]} and above.`
      : ''
  const key = `${team}|${lvl}|${f.id}`
  const o = state.ov[key]
  if (o) {
    if (o.view !== undefined) view = o.view
    if (o.edit !== undefined) edit = o.edit
    if (o.scope) scope = o.scope
    if (!view) edit = false
    note = view ? '' : 'Denied by an admin change.'
  }
  return {
    view, edit, scope, note, differs: scope !== pdef, ovScope: (o && o.scope) || '',
    over: !!o && (o.view !== undefined || o.edit !== undefined || !!o.scope), key, acc: !view ? 0 : edit ? 2 : 1,
  }
}

export interface FieldRow { f: MatrixField; x: Eff }
export interface Category {
  name: string; key: string; xs: FieldRow[]
  /** Fields that are Read only, Edit, and Denied for the current Team + Level (including local preview changes). */
  read: number; edit: number; denied: number; isOpen: boolean
}
export interface PageSummary {
  page: MatrixPage; pdef: string; nOv: number; v: number; e: number; n: number; isOpen: boolean; cats: Category[]
}

export function summarize(state: MatrixState): { who: string; pages: PageSummary[]; nOk: number; changes: number } {
  const { team, lvl, open, ov, saved } = state
  const who = `${team} ${LEVELS[lvl][0]} ${LEVELS[lvl][1]}`
  let nOk = 0
  const pages = PAGES.map((page) => {
    const xs = page.fields.map((f) => ({ f, x: eff(state, team, lvl, f, page.id) }))
    const pdef = pageScope(state, team, lvl, page.id)
    const nOv = xs.filter((o) => o.x.view && o.x.differs).length
    const v = xs.filter((o) => o.x.view).length
    const e = xs.filter((o) => o.x.edit).length
    if (v) nOk++
    const cats: Category[] = []
    xs.forEach((o) => {
      let c = cats.find((k) => k.name === o.f.s)
      if (!c) { c = { name: o.f.s, key: groupKey(page.id, o.f.s), xs: [], read: 0, edit: 0, denied: 0, isOpen: !!state.groups[groupKey(page.id, o.f.s)] }; cats.push(c) }
      c.xs.push(o)
      if (!o.x.view) c.denied++
      else if (o.x.edit) c.edit++
      else c.read++
    })
    return { page, pdef, nOv, v, e, n: page.fields.length, isOpen: open === page.id, cats }
  })
  const keys = new Set([...Object.keys(ov), ...Object.keys(saved)])
  const changes = [...keys].filter((k) => JSON.stringify(ov[k]) !== JSON.stringify(saved[k])).length
  return { who, pages, nOk, changes }
}

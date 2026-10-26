// Who a Live Bids person column offers. Built-in columns: their roster, narrowed by the row's sales territory. Custom
// People columns: Amnex employees in the verticals / departments chosen in Add column. Pure: the grid's pick-lists,
// the Add column preview and the tests all go through these functions.
import { parseMultiValue, type PeopleColumnConfig } from '@goms/domain'
import { TERRITORY_BY_STATE } from '@/data/sales-team'
import { liveSalesRoster } from '@/data/sales-hierarchy'
import { TEAM_DEPARTMENT, type OrgPerson } from '@/data/org-structure'
import { buildMasterEmployees, normalizeEmailKey } from '@/features/org/masterEmployees'
import { territoryOf } from '@/lib/meetingFilters'
import type { DeliveryTeamKey, DeliveryTeamMember, SalesPerson, SalesPosting } from '@/lib/types'
import { optionsOf, type ColumnOption, type EntityLookups, type GridColumnMeta } from './gridColumns'

type PersonColumn = Pick<GridColumnMeta, 'id' | 'type' | 'teamKey' | 'pick' | 'custom' | 'editable'>

/** What a person column stores, so which people it can hold: the Sales roster (by id or by email), one delivery
 *  team, or (custom People columns) any Amnex employee. */
export type PersonStorage = 'sales' | 'salesEmail' | 'employees' | DeliveryTeamKey

export function personStorage(col: PersonColumn): PersonStorage | null {
  if (col.pick === 'personByEmail') return 'salesEmail'
  if (col.teamKey) return col.teamKey === 'sales' ? 'sales' : col.teamKey
  if (col.type !== 'person') return null
  return col.custom ? 'employees' : 'sales'
}

/** Sales roster columns are the ones narrowed by territory. */
const onSalesRoster = (storage: PersonStorage): storage is 'sales' | 'salesEmail' => storage === 'sales' || storage === 'salesEmail'

/** Several people in one cell need storage that holds a list: only custom person columns do (a JSON list of ids). */
export const canHoldMultiple = (col: PersonColumn) => !!col.custom && col.type === 'person'

/** The Amnex employees a People column offers: active Org Structure people, plus Sales-roster people not in it
 *  (matched by email). Values are the record ids the cell stores. */
export function employeeOptions(orgPeople: OrgPerson[], salesPersons: SalesPerson[]): ColumnOption[] {
  const active = orgPeople.filter((p) => p.status === 'active')
  const inOrg = new Set(active.map((p) => normalizeEmailKey(p.email)).filter(Boolean))
  return [
    ...active.map((p) => ({ value: p.id, label: p.name, email: p.email || undefined, photoUrl: p.photoUrl ?? null, isPerson: true })),
    ...salesPersons.filter((s) => !inOrg.has(normalizeEmailKey(s.officialEmail)))
      .map((s) => ({ value: s.id, label: s.name, email: s.officialEmail || undefined, photoUrl: s.photoUrl ?? null, isPerson: true })),
  ].sort((a, b) => a.label.localeCompare(b.label))
}

export interface PersonCandidate extends ColumnOption {
  /** Amnex departments / teams (Directory › Internal). */
  departments: string[]
  /** Verticals the employee works in (Org Structure). */
  verticals: string[]
  /** Sales territory (North, South…); null = pan-India or not on the Sales roster — never filtered out. */
  territory: string | null
}

/** Everything the grid needs to scope person pick-lists, built once per grid. */
export interface PeopleScope {
  configs: Record<string, PeopleColumnConfig>
  /** Lower-cased email → Amnex departments. */
  departmentsByEmail: Map<string, string[]>
  /** Lower-cased email → verticals (Org Structure). */
  verticalsByEmail: Map<string, string[]>
  /** Lower-cased email → sales territory (null = none / pan-India). */
  territoryByEmail: Map<string, string | null>
}

/** `useEntityLookups` adds `people`; lookups built elsewhere (tests, exports) lack it and keep today's lists. */
export type PeopleLookups = EntityLookups & { people?: PeopleScope }

export function buildPeopleScope(input: {
  configs: Record<string, PeopleColumnConfig>
  salesPersons: SalesPerson[]
  currentPostings: Record<string, SalesPosting>
  deliveryTeamMembers: DeliveryTeamMember[]
  orgPeople: OrgPerson[]
}): PeopleScope {
  const departmentsByEmail = new Map<string, string[]>()
  for (const e of buildMasterEmployees(input.orgPeople, input.deliveryTeamMembers, input.salesPersons)) {
    const email = normalizeEmailKey(e.email)
    if (email) departmentsByEmail.set(email, e.departments)
  }
  const roster = new Map(liveSalesRoster(input.salesPersons, input.currentPostings).map((m) => [m.email, m]))
  const territoryByEmail = new Map(input.salesPersons.map((p) => [normalizeEmailKey(p.officialEmail), territoryOf(p.officialEmail, roster)]))
  const verticalsByEmail = new Map(input.orgPeople.map((p) => [normalizeEmailKey(p.email), p.verticals ?? []]))
  return { configs: input.configs, departmentsByEmail, verticalsByEmail, territoryByEmail }
}

/** A column's pick-list entries with their departments and territory. */
export function toCandidates(options: ColumnOption[], storage: PersonStorage, scope: Pick<PeopleScope, 'departmentsByEmail' | 'territoryByEmail'> & Partial<Pick<PeopleScope, 'verticalsByEmail'>>): PersonCandidate[] {
  const sales = onSalesRoster(storage)
  const fallback = storage === 'employees' ? [] : [sales ? 'Sales' : TEAM_DEPARTMENT[storage as DeliveryTeamKey]]
  return options.map((o) => {
    const email = normalizeEmailKey(o.email)
    return {
      ...o,
      departments: (email && scope.departmentsByEmail.get(email)) || fallback,
      verticals: (email && scope.verticalsByEmail?.get(email)) || [],
      territory: (sales && email && scope.territoryByEmail.get(email)) || null,
    }
  })
}

const lower = (s: string) => s.trim().toLowerCase()

/** Is this person in one of these departments? (case-insensitive) */
export const inDepartments = (c: Pick<PersonCandidate, 'departments'>, departments: readonly string[]) =>
  c.departments.some((d) => departments.some((x) => lower(x) === lower(d)))

/** In one of these verticals? (case-insensitive) */
const inVerticals = (c: Pick<PersonCandidate, 'verticals'>, verticals: readonly string[]) =>
  c.verticals.some((v) => verticals.some((x) => lower(x) === lower(v)))

/** Employees in the chosen verticals AND departments; an empty choice doesn't narrow. */
export function matchingPeople<T extends PersonCandidate>(candidates: T[], verticals: readonly string[], departments: readonly string[]): T[] {
  return candidates.filter((c) => (!verticals.length || inVerticals(c, verticals)) && (!departments.length || inDepartments(c, departments)))
}

/** The people a person column's dropdown offers on one row: with a setup, its individually picked people plus
 *  everyone matching its verticals and departments (no setup: every candidate); then, when the row's state has a
 *  territory, only people of that territory and people with none (pan-India). */
export function columnPeople<T extends PersonCandidate>(candidates: T[], config: PeopleColumnConfig | undefined, rowTerritory: string | null): T[] {
  const picked = new Set(config?.people ?? [])
  const verticals = config?.verticals ?? []
  const departments = config?.departments ?? []
  const narrows = verticals.length > 0 || departments.length > 0
  const matched = new Set(narrows ? matchingPeople(candidates, verticals, departments).map((c) => c.value) : [])
  const configured = picked.size || narrows ? candidates.filter((c) => picked.has(c.value) || matched.has(c.value)) : candidates
  return rowTerritory ? configured.filter((c) => !c.territory || c.territory === rowTerritory) : configured
}

/** The territory covering a row's state (the state's code, resolved by name through the States list). */
export function territoryForState(stateCode: unknown, states: ColumnOption[]): string | null {
  if (stateCode === null || stateCode === undefined || stateCode === '') return null
  const name = states.find((s) => s.value === String(stateCode))?.label
  if (!name) return null
  const key = Object.keys(TERRITORY_BY_STATE).find((state) => lower(state) === lower(name))
  return key ? TERRITORY_BY_STATE[key] : null
}

/** A cell's pick-list: the column's options narrowed by its setup (custom People columns only) and the row's
 *  territory. The cell's current person(s) always stay listed, so a value outside the setup never reads as empty. */
export function scopedOptionsOf(col: GridColumnMeta, lookups: PeopleLookups, stateCode: unknown, current: unknown): ColumnOption[] {
  const options = optionsOf(col, lookups)
  const storage = personStorage(col)
  const scope = lookups.people
  if (!storage || !scope) return options
  const rowTerritory = onSalesRoster(storage) ? territoryForState(stateCode, lookups.states) : null
  const config = col.custom ? scope.configs[col.id] : undefined
  const shown = new Set(columnPeople(toCandidates(options, storage, scope), config, rowTerritory).map((c) => c.value))
  const keep = new Set(parseMultiValue(current))
  return options.filter((o) => shown.has(o.value) || keep.has(o.value))
}

/** A custom person column set to "Multiple" edits as a multi-pick. */
export const isMultiPersonColumn = (col: GridColumnMeta, lookups: PeopleLookups) =>
  canHoldMultiple(col) && !!lookups.people?.configs[col.id]?.multiple

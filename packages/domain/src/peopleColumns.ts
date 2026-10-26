// Opportunity › Live Bids › Add column › People: who a People column's dropdown offers, chosen when it is created.
// One setup per column id, the same shape in the API (bid_people_column_settings) and the local store.

export interface PeopleColumnConfig {
  /** Verticals whose Amnex employees are offered (none = any vertical) — live, so a new joiner appears. */
  verticals: string[]
  /** Amnex departments whose members are offered (none = any department); combined with `verticals` (both must match). */
  departments: string[]
  /** Individually picked people, as the column stores them (Sales roster id, team member id or email). */
  people: string[]
  /** Several people per cell. Honoured only where the column's storage holds a list (custom person columns). */
  multiple: boolean
}

export const PEOPLE_COLUMN_ID_MAX = 120

function cleanList(value: unknown, label: string, max: number, each: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`)
  const out = [...new Set(value.map((v) => String(v).trim()).filter(Boolean))]
  if (out.length > max) throw new Error(`Choose at most ${max} ${label.toLowerCase()}.`)
  if (out.some((v) => v.length > each)) throw new Error(`${label}: an entry is too long.`)
  return out
}

/** Trimmed, de-duplicated and bounded — the same rules in the API and the local store. Throws a user-facing message. */
export function normalizePeopleColumnConfig(input: { verticals?: unknown; departments?: unknown; people?: unknown; multiple?: unknown }): PeopleColumnConfig {
  return {
    verticals: cleanList(input.verticals, 'Verticals', 50, 120),
    departments: cleanList(input.departments, 'Departments', 50, 120),
    people: cleanList(input.people, 'People', 500, 254),
    multiple: input.multiple === true,
  }
}

/** Nothing set: the column keeps its default list, so no setup is stored. */
export const isEmptyPeopleColumnConfig = (c: PeopleColumnConfig): boolean => !c.verticals.length && !c.departments.length && !c.people.length && !c.multiple

export function assertPeopleColumnId(columnId: string): string {
  const id = columnId.trim()
  if (!id || id.length > PEOPLE_COLUMN_ID_MAX) throw new Error('Unknown column.')
  return id
}

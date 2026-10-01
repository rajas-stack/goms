import { TERRITORY_BY_HEAD_EMAIL, tiersOf, type SalesTeamMember } from '@/data/sales-team'
import { liveSalesRoster } from '@/data/sales-hierarchy'
import { attendeeName, attendeeSalesPersonId } from './attendees'
import type { ComboboxOption } from '@/components/ui/Combobox'
import type { Employee, SalesPerson, SalesPosting, TimelineEvent } from './types'

export interface MeetingFilters {
  search: string
  departmentId: string
  /** `HierNode.stateCode` as a string, '' = any. */
  stateCode: string
  accountManagerId: string
  buSalesId: string
  /** Territory name (a `TERRITORY_BY_HEAD_EMAIL` value), '' = any. */
  region: string
}

export const EMPTY_MEETING_FILTERS: MeetingFilters = {
  search: '', departmentId: '', stateCode: '', accountManagerId: '', buSalesId: '', region: '',
}

export interface MeetingFacetContext {
  salesPersons: SalesPerson[]
  currentPostings: Record<string, SalesPosting>
  employeeById: Map<string, Pick<Employee, 'id' | 'name'>>
  deptById: Record<string, { id: string; name: string }>
  stateCodeByDeptId: Map<string, number | null>
}

/** Everything a meeting row is filtered/searched on, resolved once per row. */
export interface MeetingFacets {
  departmentId: string | undefined
  stateCode: number | null
  /** Attendees (by `SalesPerson.id`) whose CURRENT designation is Account Manager. */
  accountManagerIds: Set<string>
  /** Attendees whose current designation contains "BU Sales". */
  buSalesIds: Set<string>
  /** Territories of every attendee's reporting chain. */
  regions: Set<string>
  /** Lower-cased haystack for the search box. */
  searchText: string
}

export const isAccountManagerDesignation = (designation: string) =>
  designation.trim().toLowerCase() === 'account manager'

// Same substring rule the Commercial Calculator uses to pick BU Sales people.
export const isBuSalesDesignation = (designation: string) =>
  designation.toLowerCase().includes('bu sales')

/** Territory of the head at the top of `email`'s reporting chain — the last
 *  person reached before the Sales Head (or the end of the chain). A person
 *  who reports straight to the Sales Head is therefore their own head. The
 *  walk is cycle-safe; chains that don't end at a listed head give null. */
function territoryOf(email: string, byEmail: Map<string, SalesTeamMember>): string | null {
  let top = byEmail.get(email)
  if (!top) return null
  const seen = new Set([top.email])
  let cur = top
  while (cur.reportsTo) {
    const next = byEmail.get(cur.reportsTo)
    if (!next || seen.has(next.email) || tiersOf(next).includes('salesHead')) break
    seen.add(next.email)
    cur = next
    top = next
  }
  return TERRITORY_BY_HEAD_EMAIL[top.email] ?? null
}

// Roster lookups are identical for every meeting under one context, so they
// are built once per context object rather than once per row.
const lookupCache = new WeakMap<MeetingFacetContext, {
  rosterByEmail: Map<string, SalesTeamMember>
  personById: Map<string, SalesPerson>
  personByName: Map<string, SalesPerson>
}>()

function lookupsFor(ctx: MeetingFacetContext) {
  let l = lookupCache.get(ctx)
  if (!l) {
    l = {
      rosterByEmail: new Map(liveSalesRoster(ctx.salesPersons, ctx.currentPostings).map((m) => [m.email, m])),
      personById: new Map(ctx.salesPersons.map((p) => [p.id, p])),
      personByName: new Map(ctx.salesPersons.map((p) => [p.name.trim().toLowerCase(), p])),
    }
    lookupCache.set(ctx, l)
  }
  return l
}

export function buildMeetingFacets(event: TimelineEvent, ctx: MeetingFacetContext): MeetingFacets {
  const { rosterByEmail, personById, personByName } = lookupsFor(ctx)

  const accountManagerIds = new Set<string>()
  const buSalesIds = new Set<string>()
  const regions = new Set<string>()
  const names: string[] = []

  for (const a of event.attendees ?? []) {
    names.push(attendeeName(a))
    // Legacy plain-string attendees carry no id — fall back to an exact name match.
    const id = attendeeSalesPersonId(a)
    const person = (id && personById.get(id)) || personByName.get(attendeeName(a).trim().toLowerCase())
    if (!person) continue
    const designation = ctx.currentPostings[person.id]?.designation ?? ''
    if (isAccountManagerDesignation(designation)) accountManagerIds.add(person.id)
    if (isBuSalesDesignation(designation)) buSalesIds.add(person.id)
    const region = territoryOf(person.officialEmail, rosterByEmail)
    if (region) regions.add(region)
  }

  const dept = ctx.deptById[event.employeeId]
  const searchText = [
    event.title, event.customLabel, event.note, event.agenda, event.outcome, event.nextSteps,
    ctx.employeeById.get(event.employeeId)?.name, dept?.name, ...names,
  ].filter(Boolean).join('\n').toLowerCase()

  return {
    departmentId: dept?.id,
    stateCode: dept ? (ctx.stateCodeByDeptId.get(dept.id) ?? null) : null,
    accountManagerIds, buSalesIds, regions, searchText,
  }
}

/** All active filters AND together; within the attendee-derived ones a meeting
 *  matches when ANY attendee qualifies. */
export function matchesMeetingFilters(f: MeetingFacets, filters: MeetingFilters): boolean {
  if (filters.departmentId && f.departmentId !== filters.departmentId) return false
  if (filters.stateCode && String(f.stateCode) !== filters.stateCode) return false
  if (filters.accountManagerId && !f.accountManagerIds.has(filters.accountManagerId)) return false
  if (filters.buSalesId && !f.buSalesIds.has(filters.buSalesId)) return false
  if (filters.region && !f.regions.has(filters.region)) return false
  const tokens = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return tokens.every((t) => f.searchText.includes(t))
}

/** One option per territory whose head is in the live roster, labelled
 *  "Head Name (Territory)"; the value is the territory itself. */
export function regionOptions(ctx: Pick<MeetingFacetContext, 'salesPersons' | 'currentPostings'>): ComboboxOption[] {
  const byEmail = new Map(ctx.salesPersons.map((p) => [p.officialEmail, p]))
  return Object.entries(TERRITORY_BY_HEAD_EMAIL)
    .flatMap(([email, territory]) => {
      const head = byEmail.get(email)
      return head ? [{ value: territory, label: `${head.name} (${territory})` }] : []
    })
    .sort((a, b) => a.value.localeCompare(b.value))
}

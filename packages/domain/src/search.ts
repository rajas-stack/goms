import type { Domain, HierNode } from './hierarchy.js'
import { NODE_TYPE_MAP } from './hierarchy.js'

export interface SearchResult {
  /** Navigation discriminant only. 'node'/'employee' route via the existing
   *  ws.select() workspace-selection mechanism; 'other' routes via the
   *  owning category's `path()` instead. Adding a new entity type never adds
   *  a new value here — it's 'other' unless it's literally backed by
   *  HierNode or Employee. */
  kind: 'node' | 'employee' | 'other'
  /** Open string key into SEARCH_CATEGORIES — not a closed union, same
   *  "data not enum" convention as HierNode.typeKey. */
  category: string
  id: string
  title: string
  subtitle: string
  code: string | null
  domain: Domain | null
  stateCode: number | null
  /** Short reason the result matched, shown by natural-language search. */
  note?: string
  /** For a `kind: 'other'` result that isn't independently addressable — the
   *  HierNode id its `path()` should navigate to instead (e.g. a Work's
   *  owning department). Omitted for results that don't need it. */
  containerId?: string
  /** Set once a Bid Tracker bid exists for this opportunity — lets the Works
   *  category route to the bid detail page instead of the department view. */
  bidId?: string | null
}

/** Minimal structural shapes search needs — the real frontend types (and a
 *  Postgres row mapped onto the same fields) satisfy these for free. */
export interface SearchEmployee {
  id: string
  name: string
  designation: string
  code: string
  orgNodeId: string
  managerId: string | null
  vacant: boolean
  connected: boolean
  importantContact: boolean
  followUpDate: string | null
  status: string
}
export interface SearchOpportunity {
  id: string
  departmentId: string
  stateCode: number | null
  opportunityName: string
  gemTenderId: string
  vertical: string
  component: string[]
  salesPersonEmail: string
  bidId: string | null
  bidCode: string | null
  tenderLink: string | null
}
export interface SearchSalesPerson {
  id: string
  name: string
  officialEmail: string
}
/** An attendee entry: either a legacy plain name or an ID-carrying snapshot
 *  (`{salesPersonId, name}`) captured at selection time. Mirrors the
 *  frontend's `AttendeeRef` (`src/lib/types.ts`) — duplicated here since this
 *  package has no dependency on frontend code. */
export type SearchAttendeeRef = string | { salesPersonId: string; name: string }

/** Display name for an attendee, whichever shape it's in. */
function attendeeDisplayName(a: SearchAttendeeRef): string {
  return typeof a === 'string' ? a : a.name
}

export interface SearchTimelineEvent {
  id: string
  employeeId: string
  title: string
  note: string
  attendees?: SearchAttendeeRef[]
  date: string
  type: string
}
export interface SearchTransfer {
  employeeId: string
}
/** A currently-open sales posting — only `salesPersonId`/`designation` matter
 *  here, for the result subtitle. */
export interface SearchPosting {
  salesPersonId: string
  designation: string
  endDate: string | null
}

/** Everything search needs, prefetched once per call. `nodes` is every
 *  hierarchy node regardless of status (search's own state-scope detection
 *  and node lookups intentionally see archived nodes too, matching the
 *  in-memory implementation exactly); `employees` is pre-filtered to active
 *  status by the caller, same as `this.data.employees.filter(status==='active')`
 *  used to be inline in the repository. */
export interface SearchData {
  nodes: HierNode[]
  employees: SearchEmployee[]
  transfers: SearchTransfer[]
  timeline: SearchTimelineEvent[]
  opportunities: SearchOpportunity[]
  salesPersons: SearchSalesPerson[]
  postings: SearchPosting[]
  /** ISO 'YYYY-MM-DD'. Passed in rather than computed here so this module
   *  never calls `Date.now()`/`new Date()` itself. */
  today: string
}

interface BuiltContext {
  nodeById: Map<string, HierNode>
  activeNodes: HierNode[]
  activeEmployees: SearchEmployee[]
  timeline: SearchTimelineEvent[]
  opportunities: SearchOpportunity[]
  salesPersons: SearchSalesPerson[]
  currentDesignationOf: Map<string, string>
  scopeState: number | null
  inScope(nodeId: string): boolean
  subtreeIds(nodeId: string): string[]
  departmentOf(orgNodeId: string): HierNode | undefined
}

function subtreeIdsOf(nodes: HierNode[], id: string): string[] {
  const byParent = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parentId) continue
    const arr = byParent.get(n.parentId) ?? []
    arr.push(n.id)
    byParent.set(n.parentId, arr)
  }
  const out: string[] = [id]
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const childId of byParent.get(cur) ?? []) {
      out.push(childId)
      queue.push(childId)
    }
  }
  return out
}

function buildContext(data: SearchData, scopeState: number | null): BuiltContext {
  const nodeById = new Map(data.nodes.map((n) => [n.id, n] as const))
  return {
    nodeById,
    activeNodes: data.nodes.filter((n) => n.status === 'active'),
    activeEmployees: data.employees,
    timeline: data.timeline,
    opportunities: data.opportunities,
    salesPersons: data.salesPersons,
    currentDesignationOf: new Map(
      data.postings.filter((p) => p.endDate === null).map((p) => [p.salesPersonId, p.designation]),
    ),
    scopeState,
    inScope: (nodeId) => scopeState == null || nodeById.get(nodeId)?.stateCode === scopeState,
    subtreeIds: (id) => subtreeIdsOf(data.nodes, id),
    departmentOf: (orgNodeId) => {
      let cur = nodeById.get(orgNodeId)
      while (cur) {
        if (cur.typeKey === 'department') return cur
        cur = cur.parentId ? nodeById.get(cur.parentId) : undefined
      }
      return undefined
    },
  }
}

// --- Search categories ------------------------------------------------------

export type SearchCategoryColor = 'teal' | 'indigo' | 'blue' | 'amber' | 'purple'

export interface SearchCategoryDef {
  key: string
  label: string
  icon: string
  color: SearchCategoryColor
  /** Fixed display order in the grouped palette. */
  order: number
  /** Max results this category contributes to a fuzzy/grouped search, and
   *  max items per relation type inside this category's own `related()`. */
  cap: number
  /** Finds this category's own matches for a free-text query. `query` is
   *  already trimmed and lowercased by the caller. */
  match(query: string, ctx: BuiltContext): SearchResult[]
  /** Finds records connected to one of this category's own results. */
  related(result: SearchResult, ctx: BuiltContext): SearchResult[]
  /** Navigation target for a category not routed via ws.select(). Omitted
   *  for department/office/geography/employee, which route that way since
   *  they're HierNode/Employee-backed. */
  path?(result: SearchResult): string
}

const OFFICE_TYPE_KEYS = ['branch', 'division', 'office', 'unit']

/** All terms in `query` (already lowercased) must appear somewhere in `hay`
 *  (also lowercased by the caller) — same substring-AND matching `search()`
 *  already uses today. */
function matches(hay: string, query: string): boolean {
  return query.split(/\s+/).every((t) => !t || hay.includes(t))
}

function toNodeResult(n: HierNode, category: string): SearchResult {
  return {
    kind: 'node', category, id: n.id, title: n.name,
    subtitle: NODE_TYPE_MAP[n.typeKey]?.label ?? n.typeKey,
    code: n.code, domain: n.domain, stateCode: n.stateCode,
  }
}

function toEmployeeResult(e: SearchEmployee, ctx: BuiltContext, note?: string): SearchResult {
  return {
    kind: 'employee', category: 'employee', id: e.id,
    title: e.vacant ? `${e.designation || 'Vacant position'} · Vacant` : e.name,
    subtitle: e.designation || ctx.nodeById.get(e.orgNodeId)?.name || '—',
    code: e.code, domain: null, stateCode: ctx.nodeById.get(e.orgNodeId)?.stateCode ?? null, note,
  }
}

function toMeetingResult(t: SearchTimelineEvent, employee: SearchEmployee | undefined, ctx: BuiltContext): SearchResult {
  const orgNode = employee ? ctx.nodeById.get(employee.orgNodeId) : undefined
  return {
    kind: 'other', category: 'meeting', id: t.id, title: t.title,
    subtitle: employee ? `${employee.name} · ${t.date}` : t.date,
    code: null, domain: null, stateCode: orgNode?.stateCode ?? null,
  }
}

function recentMeetingsFor(employeeIds: Set<string>, ctx: BuiltContext, cap: number): SearchResult[] {
  return ctx.timeline
    .filter((t) => employeeIds.has(t.employeeId))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, cap)
    .map((t) => toMeetingResult(t, ctx.activeEmployees.find((e) => e.id === t.employeeId), ctx))
}

const departmentCategory: SearchCategoryDef = {
  key: 'department', label: 'Departments', icon: 'Building2', color: 'teal', order: 0, cap: 5,
  match(query, ctx) {
    return ctx.activeNodes
      .filter((n) => n.typeKey === 'department' && ctx.inScope(n.id))
      .filter((n) => matches(`${n.name} ${n.code ?? ''} ${n.metadata.location ?? ''}`.toLowerCase(), query))
      .map((n) => toNodeResult(n, 'department'))
  },
  related(result, ctx) {
    const out: SearchResult[] = []
    const ids = new Set(ctx.subtreeIds(result.id))
    const subtreeEmployees = ctx.activeEmployees.filter((e) => ids.has(e.orgNodeId))
    for (const e of subtreeEmployees.slice(0, this.cap)) out.push(toEmployeeResult(e, ctx))
    const offices = ctx.activeNodes.filter((n) => n.parentId === result.id)
    for (const o of offices.slice(0, this.cap)) out.push(toNodeResult(o, 'office'))
    out.push(...recentMeetingsFor(new Set(subtreeEmployees.map((e) => e.id)), ctx, this.cap))
    const stateNode = ctx.activeNodes.find((n) => n.typeKey === 'state' && n.stateCode === result.stateCode)
    if (stateNode) out.push(toNodeResult(stateNode, 'geography'))
    return out
  },
}

const employeeCategory: SearchCategoryDef = {
  key: 'employee', label: 'Employees', icon: 'User', color: 'indigo', order: 1, cap: 5,
  match(query, ctx) {
    return ctx.activeEmployees
      .filter((e) => ctx.inScope(e.orgNodeId))
      .filter((e) => matches(`${e.name} ${e.designation} ${e.code}`.toLowerCase(), query))
      .map((e) => toEmployeeResult(e, ctx))
  },
  related(result, ctx) {
    const emp = ctx.activeEmployees.find((e) => e.id === result.id)
    if (!emp) return []
    const out: SearchResult[] = []
    const orgNode = ctx.nodeById.get(emp.orgNodeId)
    const dept = ctx.departmentOf(emp.orgNodeId)
    if (dept) out.push(toNodeResult(dept, 'department'))
    if (emp.managerId) {
      const mgr = ctx.activeEmployees.find((e) => e.id === emp.managerId)
      if (mgr) out.push(toEmployeeResult(mgr, ctx))
    }
    if (orgNode && orgNode.typeKey !== 'department') out.push(toNodeResult(orgNode, 'office'))
    out.push(...recentMeetingsFor(new Set([emp.id]), ctx, this.cap))
    const stateNode = ctx.activeNodes.find((n) => n.typeKey === 'state' && n.stateCode === orgNode?.stateCode)
    if (stateNode) out.push(toNodeResult(stateNode, 'geography'))
    return out
  },
}

const officeCategory: SearchCategoryDef = {
  key: 'office', label: 'Offices', icon: 'DoorOpen', color: 'blue', order: 2, cap: 5,
  match(query, ctx) {
    return ctx.activeNodes
      .filter((n) => OFFICE_TYPE_KEYS.includes(n.typeKey) && ctx.inScope(n.id))
      .filter((n) => matches(`${n.name} ${n.code ?? ''} ${n.metadata.location ?? ''}`.toLowerCase(), query))
      .map((n) => toNodeResult(n, 'office'))
  },
  related(result, ctx) {
    const out: SearchResult[] = []
    const node = ctx.nodeById.get(result.id)
    if (!node) return out
    const dept = ctx.departmentOf(node.id)
    if (dept) out.push(toNodeResult(dept, 'department'))
    const employees = ctx.activeEmployees.filter((e) => e.orgNodeId === node.id)
    for (const e of employees.slice(0, this.cap)) out.push(toEmployeeResult(e, ctx))
    const stateNode = ctx.activeNodes.find((n) => n.typeKey === 'state' && n.stateCode === node.stateCode)
    if (stateNode) out.push(toNodeResult(stateNode, 'geography'))
    return out
  },
}

const meetingCategory: SearchCategoryDef = {
  key: 'meeting', label: 'Meetings', icon: 'MessageCircle', color: 'amber', order: 3, cap: 5,
  match(query, ctx) {
    const out: SearchResult[] = []
    for (const t of ctx.timeline) {
      const emp = ctx.activeEmployees.find((e) => e.id === t.employeeId)
      if (!emp || !ctx.inScope(emp.orgNodeId)) continue
      const hay = `${t.title} ${t.note} ${(t.attendees ?? []).map(attendeeDisplayName).join(' ')}`.toLowerCase()
      if (matches(hay, query)) out.push(toMeetingResult(t, emp, ctx))
    }
    return out
  },
  related(result, ctx) {
    const t = ctx.timeline.find((x) => x.id === result.id)
    if (!t) return []
    const emp = ctx.activeEmployees.find((e) => e.id === t.employeeId)
    return emp ? [toEmployeeResult(emp, ctx)] : []
  },
  path: (result) => `/meetings?highlight=${result.id}`,
}

const geographyCategory: SearchCategoryDef = {
  key: 'geography', label: 'Geography', icon: 'MapPin', color: 'purple', order: 4, cap: 5,
  match(query, ctx) {
    return ctx.activeNodes
      // A state node always matches regardless of scope (so a different
      // state is still reachable while browsing another one's workspace) —
      // every other geo node type is scope-filtered normally.
      .filter((n) => n.domain === 'geo' && (n.typeKey === 'state' || ctx.inScope(n.id)))
      .filter((n) => matches(`${n.name} ${n.code ?? ''}`.toLowerCase(), query))
      .map((n) => toNodeResult(n, 'geography'))
  },
  related(result, ctx) {
    return ctx.activeNodes
      .filter((n) => n.typeKey === 'department' && n.stateCode === result.stateCode)
      .slice(0, this.cap)
      .map((n) => toNodeResult(n, 'department'))
  },
}

function toWorkResult(work: SearchOpportunity, node: HierNode | undefined): SearchResult {
  return {
    kind: 'other', category: 'work', id: work.id,
    title: work.opportunityName || 'Untitled opportunity',
    subtitle: `${node?.name ?? 'Unknown department'} · ${work.vertical}`,
    code: null, domain: node?.domain ?? null, stateCode: work.stateCode,
    containerId: work.departmentId, bidId: work.bidId,
  }
}

const worksCategory: SearchCategoryDef = {
  key: 'work', label: 'Works', icon: 'Briefcase', color: 'blue', order: 5, cap: 5,
  match(query, ctx) {
    const out: SearchResult[] = []
    for (const w of ctx.opportunities) {
      if (!ctx.inScope(w.departmentId)) continue
      const salesName = ctx.salesPersons.find((p) => p.officialEmail === w.salesPersonEmail)?.name ?? ''
      const hay = `${w.opportunityName} ${w.gemTenderId} ${w.vertical} ${w.component.join(' ')} ${salesName} ${w.bidCode ?? ''} ${w.tenderLink ?? ''}`.toLowerCase()
      if (matches(hay, query)) out.push(toWorkResult(w, ctx.nodeById.get(w.departmentId)))
    }
    return out
  },
  related(result, ctx) {
    const node = result.containerId ? ctx.nodeById.get(result.containerId) : undefined
    return node ? [toNodeResult(node, 'department')] : []
  },
  path: (result) => (result.bidId
    ? `/bid-tracker/bid/${result.bidId}`
    : (result.containerId && result.stateCode != null ? `/state/${result.stateCode}?sel=${result.containerId}&kind=node` : '/')),
}

function toSalesPersonResult(p: SearchSalesPerson, ctx: BuiltContext): SearchResult {
  return {
    // Not 'employee': that kind routes via ws.select on the government-side
    // Employee record. A SalesPerson is a distinct record type, so — per the
    // rule above — this is 'other', routed via this category's own `path()`.
    kind: 'other', category: 'salesPerson', id: p.id, title: p.name,
    // Designation over email — it's what the palette's avatar+subtitle row
    // benefits from most; email is still indexed for matching below.
    subtitle: ctx.currentDesignationOf.get(p.id) || p.officialEmail,
    code: null, domain: null, stateCode: null,
  }
}

const salesPersonCategory: SearchCategoryDef = {
  key: 'salesPerson', label: 'Sales Team', icon: 'Briefcase', color: 'purple', order: 6, cap: 5,
  match(query, ctx) {
    return ctx.salesPersons
      .filter((p) =>
        matches(`${p.name} ${p.officialEmail} ${ctx.currentDesignationOf.get(p.id) ?? ''}`.toLowerCase(), query))
      .map((p) => toSalesPersonResult(p, ctx))
  },
  related() {
    return []
  },
  path: (result) => `/sales/roster?sel=${result.id}&kind=salesPerson`,
}

export const SEARCH_CATEGORIES: SearchCategoryDef[] = [
  departmentCategory, employeeCategory, officeCategory, meetingCategory, geographyCategory, worksCategory,
  salesPersonCategory,
]
export const SEARCH_CATEGORY_MAP: Record<string, SearchCategoryDef> =
  Object.fromEntries(SEARCH_CATEGORIES.map((c) => [c.key, c]))

// --- Top-level search --------------------------------------------------------

const categoryForNode = (n: HierNode): string =>
  n.domain === 'geo' ? 'geography' : n.typeKey === 'department' ? 'department' : 'office'

function empResult(e: SearchEmployee, ctx: BuiltContext, note?: string): SearchResult {
  return toEmployeeResult(e, ctx, note)
}
function nodeResult(n: HierNode, note?: string): SearchResult {
  return {
    kind: 'node', category: categoryForNode(n), id: n.id, title: n.name,
    subtitle: NODE_TYPE_MAP[n.typeKey]?.label ?? n.typeKey,
    code: n.code, domain: n.domain, stateCode: n.stateCode, note,
  }
}

/** Natural-language-aware search. Recognises intent keywords ("connected",
 *  "vacant", "transferred", "follow-ups due"), a state scope by name, and
 *  relational phrases ("under X", "reporting to X"), then falls back to
 *  fuzzy matching over names/codes/designations/locations. */
export function performSearch(query: string, stateCode: number | undefined, data: SearchData): SearchResult[] {
  const raw = query.trim()
  if (!raw) return []
  const q = raw.toLowerCase()
  const nodeById = new Map(data.nodes.map((n) => [n.id, n] as const))
  const activeEmps = data.employees
  const transferredIds = new Set(data.transfers.map((t) => t.employeeId))
  const today = data.today

  // --- state scope: an explicit state name in the query wins over context ---
  let scopeState = stateCode ?? null
  let scopeName = ''
  for (const s of data.nodes.filter((n) => n.typeKey === 'state')) {
    const nm = s.name.toLowerCase()
    if (nm.length >= 3 && q.includes(nm) && nm.length > scopeName.length) {
      scopeState = s.stateCode
      scopeName = nm
    }
  }
  const inScope = (nodeId: string) => scopeState == null || nodeById.get(nodeId)?.stateCode === scopeState

  let rest = scopeName ? q.replace(scopeName, ' ') : q

  // --- relational phrases ---------------------------------------------------
  const built = buildContext(data, scopeState)

  const reportsTo = rest.match(/report(?:s|ing)?\s+to\s+(.+)$/)
  if (reportsTo) {
    const term = reportsTo[1].trim()
    const managers = activeEmps.filter((m) =>
      !m.vacant && (m.name.toLowerCase().includes(term) || m.designation.toLowerCase().includes(term)))
    const mIds = new Set(managers.map((m) => m.id))
    return activeEmps
      .filter((e) => e.managerId && mIds.has(e.managerId) && inScope(e.orgNodeId))
      .slice(0, 24)
      .map((e) => empResult(e, built, 'Reports to match'))
  }
  const under = rest.match(/(?:under|within|inside|below)\s+(.+)$/)
  if (under) {
    const term = under[1].trim()
    const container = data.nodes.find((n) =>
      n.status === 'active' && n.name.toLowerCase().includes(term) && inScope(n.id))
    if (container) {
      const ids = new Set(built.subtreeIds(container.id))
      const out: SearchResult[] = [nodeResult(container, 'Container')]
      for (const e of activeEmps) {
        if (ids.has(e.orgNodeId)) out.push(empResult(e, built, `Under ${container.name}`))
        if (out.length >= 24) break
      }
      return out
    }
  }

  // --- intent flags ---------------------------------------------------------
  const has = (re: RegExp) => re.test(q)
  const wantVacant = has(/\bvacan/)
  const wantTransferred = has(/\btransfer/)
  const wantNotConnected = has(/\b(not connected|unconnected|no contact)\b/)
  const wantConnected = !wantNotConnected && has(/\bconnected\b/)
  const wantFollowUp = has(/\bfollow[-\s]?ups?\b/)
  const wantImportant = has(/\b(high[-\s]?priority|important|vip|priority)\b/)
  const dueToday = wantFollowUp && has(/\btoday\b/)

  const intentActive = wantVacant || wantTransferred || wantConnected || wantNotConnected
    || wantFollowUp || wantImportant

  if (intentActive) {
    // Free-text remainder after stripping recognised keywords, matched
    // against name/designation/office so "collector" in "connected collector"
    // still narrows the set.
    const stop = /\b(connected|unconnected|vacant|vacancy|vacancies|transferred|transfers?|follow[-\s]?ups?|due|today|high|priority|important|vip|officers?|people|show|list|all|in|the|not|no|contact)\b/g
    const text = rest.replace(stop, ' ').replace(/\s+/g, ' ').trim()
    const results = activeEmps.filter((e) => {
      if (!inScope(e.orgNodeId)) return false
      if (wantVacant && !e.vacant) return false
      if (!wantVacant && e.vacant && !(wantTransferred || wantFollowUp)) return false
      if (wantConnected && (!e.connected || e.vacant)) return false
      if (wantNotConnected && (e.connected || e.vacant)) return false
      if (wantTransferred && !transferredIds.has(e.id)) return false
      if (wantImportant && !e.importantContact) return false
      if (wantFollowUp) {
        if (!e.followUpDate) return false
        if (dueToday ? e.followUpDate !== today : e.followUpDate > today) return false
      }
      if (text) {
        const hay = `${e.name} ${e.designation} ${nodeById.get(e.orgNodeId)?.name ?? ''} ${nodeById.get(e.orgNodeId)?.metadata.location ?? ''}`.toLowerCase()
        if (!hay.includes(text)) return false
      }
      return true
    })
    const label = wantVacant ? 'Vacant' : wantTransferred ? 'Transferred'
      : wantFollowUp ? (dueToday ? 'Due today' : 'Follow-up due') : wantImportant ? 'High priority'
      : wantNotConnected ? 'Not connected' : 'Connected'
    return results.slice(0, 24).map((e) => empResult(e, built, label))
  }

  // --- fuzzy fallback: one call per registered category, capped per-category -----
  const results: SearchResult[] = []
  for (const category of SEARCH_CATEGORIES) {
    try {
      results.push(...category.match(rest, built).slice(0, category.cap))
    } catch {
      // one category's bug never blanks the rest of the palette
    }
  }
  return results
}

export function performRelatedRecords(result: SearchResult, data: SearchData): SearchResult[] {
  const category = SEARCH_CATEGORY_MAP[result.category]
  if (!category) return []
  const ctx = buildContext(data, null)
  try {
    return category.related(result, ctx)
  } catch {
    return []
  }
}

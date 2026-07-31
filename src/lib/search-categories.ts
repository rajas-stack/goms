import { NODE_TYPE_MAP } from './node-types'
import type { Employee, HierNode, Opportunity, SalesPerson, SearchResult, TimelineEvent } from './types'

export interface SearchContext {
  nodeById: Map<string, HierNode>
  activeNodes: HierNode[]
  activeEmployees: Employee[]
  timeline: TimelineEvent[]
  /** Every opportunity, for the `work` category. */
  opportunities: Opportunity[]
  /** Every AMNEX salesperson, for the `salesPerson` category. */
  salesPersons: SalesPerson[]
  /** Each salesperson's current designation, for the result subtitle. */
  currentDesignationOf: Map<string, string>
  /** Non-null when results should be scoped to one state. */
  scopeState: number | null
  inScope(nodeId: string): boolean
  subtreeIds(nodeId: string): string[]
  /** Walks a posting's org-node ancestors (inclusive) up to the nearest
   *  department. Returns the node itself if it's already a department. */
  departmentOf(orgNodeId: string): HierNode | undefined
}

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
  match(query: string, ctx: SearchContext): SearchResult[]
  /** Finds records connected to one of this category's own results. */
  related(result: SearchResult, ctx: SearchContext): SearchResult[]
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

function toEmployeeResult(e: Employee, ctx: SearchContext): SearchResult {
  return {
    kind: 'employee', category: 'employee', id: e.id,
    title: e.vacant ? `${e.designation || 'Vacant position'} · Vacant` : e.name,
    subtitle: e.designation || ctx.nodeById.get(e.orgNodeId)?.name || '—',
    code: e.code, domain: null, stateCode: ctx.nodeById.get(e.orgNodeId)?.stateCode ?? null,
  }
}

function toMeetingResult(t: TimelineEvent, employee: Employee | undefined, ctx: SearchContext): SearchResult {
  const orgNode = employee ? ctx.nodeById.get(employee.orgNodeId) : undefined
  return {
    kind: 'other', category: 'meeting', id: t.id, title: t.title,
    subtitle: employee ? `${employee.name} · ${t.date}` : t.date,
    code: null, domain: null, stateCode: orgNode?.stateCode ?? null,
  }
}

function recentMeetingsFor(employeeIds: Set<string>, ctx: SearchContext, cap: number): SearchResult[] {
  return ctx.timeline
    .filter((t) => employeeIds.has(t.employeeId))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, cap)
    .map((t) => toMeetingResult(t, ctx.activeEmployees.find((e) => e.id === t.employeeId), ctx))
}

export const departmentCategory: SearchCategoryDef = {
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

export const employeeCategory: SearchCategoryDef = {
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

export const officeCategory: SearchCategoryDef = {
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

export const meetingCategory: SearchCategoryDef = {
  key: 'meeting', label: 'Meetings', icon: 'MessageCircle', color: 'amber', order: 3, cap: 5,
  match(query, ctx) {
    const out: SearchResult[] = []
    for (const t of ctx.timeline) {
      const emp = ctx.activeEmployees.find((e) => e.id === t.employeeId)
      if (!emp || !ctx.inScope(emp.orgNodeId)) continue
      const hay = `${t.title} ${t.note} ${(t.attendees ?? []).join(' ')}`.toLowerCase()
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

export const geographyCategory: SearchCategoryDef = {
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

function toWorkResult(work: Opportunity, node: HierNode | undefined): SearchResult {
  return {
    kind: 'other', category: 'work', id: work.id,
    title: work.opportunityName || 'Untitled opportunity',
    subtitle: `${node?.name ?? 'Unknown department'} · ${work.vertical}`,
    code: null, domain: node?.domain ?? null, stateCode: work.stateCode,
    containerId: work.departmentId,
  }
}

export const worksCategory: SearchCategoryDef = {
  key: 'work', label: 'Works', icon: 'Briefcase', color: 'blue', order: 5, cap: 5,
  match(query, ctx) {
    const out: SearchResult[] = []
    for (const w of ctx.opportunities) {
      if (!ctx.inScope(w.departmentId)) continue
      const salesName = ctx.salesPersons.find((p) => p.officialEmail === w.salesPersonEmail)?.name ?? ''
      const hay = `${w.opportunityName} ${w.gemTenderId} ${w.vertical} ${w.component.join(' ')} ${salesName}`.toLowerCase()
      if (matches(hay, query)) out.push(toWorkResult(w, ctx.nodeById.get(w.departmentId)))
    }
    return out
  },
  related(result, ctx) {
    const node = result.containerId ? ctx.nodeById.get(result.containerId) : undefined
    return node ? [toNodeResult(node, 'department')] : []
  },
  path: (result) => (result.containerId && result.stateCode != null
    ? `/state/${result.stateCode}?sel=${result.containerId}&kind=node`
    : '/'),
}

function toSalesPersonResult(p: SalesPerson, ctx: SearchContext): SearchResult {
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

export const salesPersonCategory: SearchCategoryDef = {
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

import { isoToday } from '@/lib/dates'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { SEARCH_CATEGORIES, SEARCH_CATEGORY_MAP, type SearchContext } from '@/lib/search-categories'
import type { Employee, HierNode, RelationshipQuality, RelationshipStatus, SearchResult } from '@/lib/types'
import type { InteractionSummary, RelationshipAnalytics } from '../in-memory/repository'
import { supabase } from './client'
import { listAllNodes } from './hierarchy'
import { listAllTimelineEvents, listAllTransfers, toEmployees } from './employees'
import { listOpportunities } from './ownership'
import { listSalesPersons, currentPostings } from './sales-people'
import type { Database } from './database.types'

type EmployeeRow = Database['public']['Tables']['employees']['Row']

/** `listAllEmployees` (employees.ts) is active-only by contract (spec-named
 *  "every active employee"). `search`/`relationshipAnalytics` need every
 *  employee regardless of status — an inactive employee's past meeting or
 *  transfer is still real history — matching the in-memory version's
 *  unfiltered `this.data.employees`. */
async function listAllEmployeesAnyStatus(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*')
  if (error) throw error
  return toEmployees(data as EmployeeRow[])
}

async function loadCrossCuttingData() {
  const [nodes, employees, timeline, transfers, opportunities, salesPersons, postings] = await Promise.all([
    listAllNodes(), listAllEmployeesAnyStatus(), listAllTimelineEvents(), listAllTransfers(),
    listOpportunities(), listSalesPersons(), currentPostings(),
  ])
  return { nodes, employees, timeline, transfers, opportunities, salesPersons, postings }
}

type CrossCuttingData = Awaited<ReturnType<typeof loadCrossCuttingData>>

/** Direct port of the in-memory `subtreeIds` — walks the already-fetched flat
 *  node list rather than issuing the `department_subtree_ids`/
 *  `geo_node_subtree_ids` RPCs, since `SearchContext.subtreeIds` is a
 *  synchronous contract shared with every `SEARCH_CATEGORIES` matcher. */
function computeSubtreeIds(nodes: HierNode[], id: string): string[] {
  const out = [id]
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of nodes) {
      if (n.parentId === cur) {
        out.push(n.id)
        stack.push(n.id)
      }
    }
  }
  return out
}

/** Direct port of `InMemoryRepository.buildSearchContext`. */
function buildSearchContext(data: CrossCuttingData, scopeState: number | null): SearchContext {
  const nodeById = new Map(data.nodes.map((n) => [n.id, n] as const))
  return {
    nodeById,
    activeNodes: data.nodes.filter((n) => n.status === 'active'),
    activeEmployees: data.employees.filter((e) => e.status === 'active'),
    timeline: data.timeline,
    opportunities: data.opportunities,
    salesPersons: data.salesPersons,
    currentDesignationOf: new Map(Object.entries(data.postings).map(([id, p]) => [id, p.designation])),
    scopeState,
    inScope: (nodeId) => scopeState == null || nodeById.get(nodeId)?.stateCode === scopeState,
    subtreeIds: (id) => computeSubtreeIds(data.nodes, id),
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

/** Natural-language-aware search — direct port of `InMemoryRepository.search`
 *  (recognises intent keywords, a state scope by name, and relational
 *  phrases, then falls back to fuzzy matching over `SEARCH_CATEGORIES`), now
 *  fetching its working set from Supabase once per call instead of reading
 *  the in-memory blob. */
export async function search(query: string, stateCode?: number): Promise<SearchResult[]> {
  const raw = query.trim()
  if (!raw) return []
  const q = raw.toLowerCase()
  const data = await loadCrossCuttingData()
  const nodeById = new Map(data.nodes.map((n) => [n.id, n] as const))
  const activeEmps = data.employees.filter((e) => e.status === 'active')
  const transferredIds = new Set(data.transfers.map((t) => t.employeeId))
  const today = isoToday()

  const categoryForNode = (n: HierNode): string =>
    n.domain === 'geo' ? 'geography' : n.typeKey === 'department' ? 'department' : 'office'

  const empResult = (e: Employee, note?: string): SearchResult => ({
    kind: 'employee', category: 'employee', id: e.id,
    title: e.vacant ? `${e.designation || 'Vacant position'} · Vacant` : e.name,
    subtitle: e.designation || nodeById.get(e.orgNodeId)?.name || '—',
    code: e.code, domain: null, stateCode: nodeById.get(e.orgNodeId)?.stateCode ?? null, note,
  })
  const nodeResult = (n: HierNode, note?: string): SearchResult => ({
    kind: 'node', category: categoryForNode(n), id: n.id, title: n.name,
    subtitle: NODE_TYPE_MAP[n.typeKey]?.label ?? n.typeKey,
    code: n.code, domain: n.domain, stateCode: n.stateCode, note,
  })

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

  const rest = scopeName ? q.replace(scopeName, ' ') : q

  // --- relational phrases ---------------------------------------------------
  const reportsTo = rest.match(/report(?:s|ing)?\s+to\s+(.+)$/)
  if (reportsTo) {
    const term = reportsTo[1].trim()
    const managers = activeEmps.filter((m) =>
      !m.vacant && (m.name.toLowerCase().includes(term) || m.designation.toLowerCase().includes(term)))
    const mIds = new Set(managers.map((m) => m.id))
    return activeEmps
      .filter((e) => e.managerId && mIds.has(e.managerId) && inScope(e.orgNodeId))
      .slice(0, 24)
      .map((e) => empResult(e, 'Reports to match'))
  }
  const under = rest.match(/(?:under|within|inside|below)\s+(.+)$/)
  if (under) {
    const term = under[1].trim()
    const container = data.nodes.find((n) =>
      n.status === 'active' && n.name.toLowerCase().includes(term) && inScope(n.id))
    if (container) {
      const ids = new Set(computeSubtreeIds(data.nodes, container.id))
      const out: SearchResult[] = [nodeResult(container, 'Container')]
      for (const e of activeEmps) {
        if (ids.has(e.orgNodeId)) out.push(empResult(e, `Under ${container.name}`))
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
    return results.slice(0, 24).map((e) => empResult(e, label))
  }

  // --- fuzzy fallback: one call per registered category, capped per-category -----
  const ctx = buildSearchContext(data, scopeState)
  const results: SearchResult[] = []
  for (const category of SEARCH_CATEGORIES) {
    try {
      results.push(...category.match(rest, ctx).slice(0, category.cap))
    } catch {
      // one category's bug never blanks the rest of the palette
    }
  }
  return results
}

/** Direct port of `InMemoryRepository.relatedRecords`. */
export async function relatedRecords(result: SearchResult): Promise<SearchResult[]> {
  const category = SEARCH_CATEGORY_MAP[result.category]
  if (!category) return []
  const data = await loadCrossCuttingData()
  const ctx = buildSearchContext(data, null)
  try {
    return category.related(result, ctx)
  } catch {
    return []
  }
}

/** Direct port of `InMemoryRepository.relationshipAnalytics`. */
export async function relationshipAnalytics(): Promise<RelationshipAnalytics> {
  const today = isoToday()
  const data = await loadCrossCuttingData()
  const active = data.employees.filter((e) => e.status === 'active')
  const people = active.filter((e) => !e.vacant)
  const connected = people.filter((e) => e.connected)
  const qualityDist: Record<RelationshipQuality, number> =
    { excellent: 0, good: 0, neutral: 0, weak: 0, poor: 0 }
  const statusDist: Record<RelationshipStatus, number> =
    { engaged: 0, developing: 0, dormant: 0, new: 0 }
  for (const e of connected) {
    qualityDist[e.relationshipQuality] += 1
    statusDist[e.relationshipStatus] += 1
  }
  const nameById = new Map(data.employees.map((e) => [e.id, e] as const))

  const recentInteractions: InteractionSummary[] = data.timeline
    .filter((t) => t.source === 'manual' && nameById.get(t.employeeId) && !nameById.get(t.employeeId)!.vacant)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((t) => ({ employeeId: t.employeeId, name: nameById.get(t.employeeId)!.name, type: t.type, title: t.title, date: t.date }))

  const upcomingMeetings: InteractionSummary[] = data.timeline
    .filter((t) => (t.type === 'meeting' || t.type === 'inPerson') && t.date >= today
      && nameById.get(t.employeeId) && !nameById.get(t.employeeId)!.vacant)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)
    .map((t) => ({ employeeId: t.employeeId, name: nameById.get(t.employeeId)!.name, type: t.type, title: t.title, date: t.date }))

  return {
    total: people.length,
    connected: connected.length,
    notConnected: people.length - connected.length,
    vacant: active.filter((e) => e.vacant).length,
    transfers: data.transfers.length,
    highPriority: people.filter((e) => e.importantContact).length,
    qualityDist, statusDist, recentInteractions, upcomingMeetings,
  }
}

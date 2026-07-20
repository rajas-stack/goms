import type {
  Charge, Domain, Employee, HierNode, PreferredComm, RelationshipQuality, RelationshipStatus,
  SearchResult, Status, TimelineEvent, TimelineEventType, Transfer,
} from '@/lib/types'
import { uid } from '@/lib/utils'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { buildSeed, type GormsData } from './seed'

export interface StateSummary {
  code: number
  name: string
  departments: number
  offices: number
  employees: number
}

export interface InteractionSummary {
  employeeId: string
  name: string
  type: TimelineEventType
  title: string
  date: string
}

export interface FollowUpSummary {
  employeeId: string
  name: string
  designation: string
  date: string
  overdue: boolean
}

/** Aggregate relationship metrics powering the analytics dashboard. */
export interface RelationshipAnalytics {
  total: number
  connected: number
  notConnected: number
  vacant: number
  transfers: number
  highPriority: number
  followUpsDue: number
  qualityDist: Record<RelationshipQuality, number>
  statusDist: Record<RelationshipStatus, number>
  recentInteractions: InteractionSummary[]
  upcomingFollowUps: FollowUpSummary[]
}

export interface CreateNodeInput {
  domain: Domain
  typeKey: string
  parentId: string | null
  stateCode: number | null
  name: string
  metadata?: Record<string, string>
}

export interface CreateEmployeeInput {
  name: string
  designation: string
  email: string
  phone: string
  photoUrl?: string | null
  orgNodeId: string
  managerId: string | null
  vacant?: boolean
  connected?: boolean
  relationshipStatus?: RelationshipStatus
  relationshipQuality?: RelationshipQuality
  relationshipType?: string
  introducedBy?: string
  importantContact?: boolean
  preferredComm?: PreferredComm
  lastInteractionAt?: string | null
  followUpDate?: string | null
  notes?: string
  charges?: Charge[]
  metadata?: Record<string, string>
}

export interface AddTimelineInput {
  employeeId: string
  type: TimelineEventType
  title: string
  date: string
  time?: string
  note?: string
  attendees?: string[]
}

export interface TransferInput {
  employeeId: string
  toOrgNodeId: string
  toDesignation: string
  /** New reporting manager after the transfer. `undefined` leaves the manager
   *  unchanged; `null` clears it (top of chain). */
  toManagerId?: string | null
  effectiveDate: string
  reason: string
  remarks?: string
}

/** All persistence flows through this interface. The in-memory implementation
 *  below can be replaced by a Supabase-backed one with no UI changes. */
export interface Repository {
  listStates(): Promise<StateSummary[]>
  getState(code: number): Promise<HierNode | undefined>
  getNode(id: string): Promise<HierNode | undefined>
  listChildren(parentId: string): Promise<HierNode[]>
  listOrgRoots(stateCode: number): Promise<HierNode[]>
  listPostingNodes(stateCode: number): Promise<HierNode[]>
  breadcrumb(id: string): Promise<HierNode[]>
  childCount(id: string): Promise<number>
  /** The country node — the root of the geography hierarchy. */
  geoRoot(): Promise<HierNode | undefined>
  /** Number of active children for each active child of `parentId`, in one pass
   *  (e.g. districts-per-state) — powers the geography explorer's counts. */
  childCounts(parentId: string): Promise<Record<string, number>>

  createNode(input: CreateNodeInput): Promise<HierNode>
  updateNode(id: string, patch: Partial<Pick<HierNode, 'name' | 'metadata'>>): Promise<HierNode>
  setNodeStatus(id: string, status: Status): Promise<void>
  deleteNode(id: string): Promise<void>
  moveNode(id: string, newParentId: string | null): Promise<void>
  duplicateNode(id: string): Promise<HierNode>

  listEmployeesUnder(orgNodeId: string): Promise<Employee[]>
  listEmployeesDirect(orgNodeId: string): Promise<Employee[]>
  listEmployeesByState(stateCode: number): Promise<Employee[]>
  listAllEmployees(): Promise<Employee[]>
  /** Map of active employee id → the department node they sit under (if any).
   *  Powers the Directory's Department filter without walking the tree per row. */
  listEmployeeDepartments(): Promise<Record<string, { id: string; name: string }>>
  getEmployee(id: string): Promise<Employee | undefined>
  directReports(employeeId: string): Promise<Employee[]>
  reportingChain(employeeId: string): Promise<Employee[]>
  createEmployee(input: CreateEmployeeInput): Promise<Employee>
  updateEmployee(id: string, patch: Partial<Employee>): Promise<Employee>
  setManager(employeeId: string, managerId: string | null): Promise<void>
  deleteEmployee(id: string): Promise<void>

  listTimeline(employeeId: string): Promise<TimelineEvent[]>
  addTimelineEvent(input: AddTimelineInput): Promise<TimelineEvent>
  deleteTimelineEvent(id: string): Promise<void>

  listTransfers(employeeId: string): Promise<Transfer[]>
  transferEmployee(input: TransferInput): Promise<Transfer>

  addCharge(employeeId: string, charge: Omit<Charge, 'id'>): Promise<Charge>
  removeCharge(employeeId: string, chargeId: string): Promise<void>

  search(query: string, stateCode?: number): Promise<SearchResult[]>
  importChildren(parentId: string, names: string[]): Promise<number>
  moveTargets(nodeId: string): Promise<HierNode[]>
  reorderNode(id: string, beforeId: string | null): Promise<void>
  relationshipAnalytics(): Promise<RelationshipAnalytics>
}

/** ISO date for "today" — used by follow-up-due search & analytics. */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Org node types an employee can be posted at. */
const POSTING_TYPES = new Set(['office', 'unit'])

class InMemoryRepository implements Repository {
  private data: GormsData = buildSeed()

  constructor() {
    // Enforce the branch invariants on load: no duplicate branches, and every
    // department carries a default Root branch.
    this.dedupeBranches()
    this.ensureRootBranches()
  }

  /** Collapse branches that share a name under the same parent, reassigning the
   *  duplicates' children to the kept branch. Keeps the hierarchy clean. */
  private dedupeBranches() {
    const byParent = new Map<string, HierNode[]>()
    for (const n of this.data.nodes) {
      if (n.typeKey !== 'branch' || !n.parentId) continue
      const arr = byParent.get(n.parentId) ?? []
      arr.push(n)
      byParent.set(n.parentId, arr)
    }
    const removeIds = new Set<string>()
    for (const branches of byParent.values()) {
      const seen = new Map<string, HierNode>()
      for (const b of branches) {
        const key = b.name.trim().toLowerCase()
        const keep = seen.get(key)
        if (keep) {
          for (const child of this.data.nodes) {
            if (child.parentId === b.id) child.parentId = keep.id
          }
          removeIds.add(b.id)
        } else {
          seen.set(key, b)
        }
      }
    }
    if (removeIds.size) this.data.nodes = this.data.nodes.filter((n) => !removeIds.has(n.id))
  }

  /** Give every department a default "Root" branch if it doesn't have one. */
  private ensureRootBranches() {
    for (const dept of this.data.nodes.filter((n) => n.typeKey === 'department')) {
      const hasRoot = this.data.nodes.some(
        (n) => n.parentId === dept.id && n.typeKey === 'branch' && n.name.trim().toLowerCase() === 'root',
      )
      if (!hasRoot) this.data.nodes.push(this.makeRootBranch(dept))
    }
  }

  private makeRootBranch(dept: HierNode): HierNode {
    return {
      id: uid('org'), domain: 'org', typeKey: 'branch', parentId: dept.id,
      stateCode: dept.stateCode, name: 'Root', code: null, sortOrder: -1, metadata: {}, status: 'active',
    }
  }

  private activeChildren(parentId: string): HierNode[] {
    return this.data.nodes
      .filter((n) => n.parentId === parentId && n.status === 'active')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }

  private subtreeIds(id: string): string[] {
    const out = [id]
    const stack = [id]
    while (stack.length) {
      const cur = stack.pop()!
      for (const n of this.data.nodes) {
        if (n.parentId === cur) {
          out.push(n.id)
          stack.push(n.id)
        }
      }
    }
    return out
  }

  async listStates(): Promise<StateSummary[]> {
    const states = this.data.nodes.filter((n) => n.typeKey === 'state')
    return states
      .map((s) => {
        const code = s.stateCode!
        const orgUnder = this.data.nodes.filter((n) => n.domain === 'org' && n.stateCode === code)
        return {
          code,
          name: s.name,
          departments: orgUnder.filter((n) => n.typeKey === 'department').length,
          offices: orgUnder.filter((n) => n.typeKey === 'office').length,
          employees: this.data.employees.filter((e) =>
            orgUnder.some((n) => n.id === e.orgNodeId),
          ).length,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async getState(code: number) {
    return this.data.nodes.find((n) => n.typeKey === 'state' && n.stateCode === code)
  }

  async getNode(id: string) {
    return this.data.nodes.find((n) => n.id === id)
  }

  async listChildren(parentId: string) {
    return this.activeChildren(parentId)
  }

  async listOrgRoots(stateCode: number) {
    return this.data.nodes
      .filter((n) => n.domain === 'org' && n.typeKey === 'department' && n.stateCode === stateCode && n.status === 'active')
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }

  /** Org nodes an employee can be posted at (offices/units) in a state — used
   *  as transfer targets. */
  async listPostingNodes(stateCode: number) {
    return this.data.nodes
      .filter((n) => n.domain === 'org' && POSTING_TYPES.has(n.typeKey) && n.stateCode === stateCode && n.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async breadcrumb(id: string) {
    const chain: HierNode[] = []
    let cur = this.data.nodes.find((n) => n.id === id)
    while (cur) {
      chain.unshift(cur)
      cur = cur.parentId ? this.data.nodes.find((n) => n.id === cur!.parentId) : undefined
    }
    return chain
  }

  async childCount(id: string) {
    return this.data.nodes.filter((n) => n.parentId === id && n.status === 'active').length
  }

  async geoRoot() {
    return this.data.nodes.find((n) => n.typeKey === 'country')
  }

  async childCounts(parentId: string) {
    const out: Record<string, number> = {}
    for (const child of this.activeChildren(parentId)) {
      out[child.id] = this.data.nodes.filter((n) => n.parentId === child.id && n.status === 'active').length
    }
    return out
  }

  async createNode(input: CreateNodeInput) {
    // Never create a second branch with the same name under one parent.
    if (input.typeKey === 'branch' && input.parentId) {
      const dup = this.activeChildren(input.parentId).find(
        (c) => c.typeKey === 'branch' && c.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
      )
      if (dup) return dup
    }
    const siblings = input.parentId ? this.activeChildren(input.parentId) : []
    const node: HierNode = {
      id: uid(input.domain),
      domain: input.domain,
      typeKey: input.typeKey,
      parentId: input.parentId,
      stateCode: input.stateCode,
      name: input.name,
      code: null,
      sortOrder: siblings.length,
      metadata: input.metadata ?? {},
      status: 'active',
    }
    this.data.nodes.push(node)
    // A new department is born with its default Root branch.
    if (node.typeKey === 'department') this.data.nodes.push(this.makeRootBranch(node))
    return node
  }

  async updateNode(id: string, patch: Partial<Pick<HierNode, 'name' | 'metadata'>>) {
    const node = this.data.nodes.find((n) => n.id === id)!
    if (patch.name !== undefined) node.name = patch.name
    if (patch.metadata !== undefined) node.metadata = patch.metadata
    return node
  }

  async setNodeStatus(id: string, status: Status) {
    for (const nid of this.subtreeIds(id)) {
      const n = this.data.nodes.find((x) => x.id === nid)
      if (n) n.status = status
    }
  }

  async deleteNode(id: string) {
    const ids = new Set(this.subtreeIds(id))
    this.data.nodes = this.data.nodes.filter((n) => !ids.has(n.id))
    this.data.employees = this.data.employees.filter((e) => !ids.has(e.orgNodeId))
  }

  async moveNode(id: string, newParentId: string | null) {
    if (newParentId && this.subtreeIds(id).includes(newParentId)) {
      throw new Error('Cannot move a node into its own subtree')
    }
    const node = this.data.nodes.find((n) => n.id === id)!
    node.parentId = newParentId
  }

  async duplicateNode(id: string) {
    const original = this.data.nodes.find((n) => n.id === id)!
    const idMap = new Map<string, string>()
    const clones: HierNode[] = []
    for (const oldId of this.subtreeIds(id)) {
      const src = this.data.nodes.find((n) => n.id === oldId)!
      const newId = uid(src.domain)
      idMap.set(oldId, newId)
      clones.push({ ...src, id: newId, metadata: { ...src.metadata } })
    }
    for (const clone of clones) {
      if (clone.id === idMap.get(id)) {
        clone.parentId = original.parentId
        clone.name = `${original.name} (Copy)`
      } else {
        clone.parentId = idMap.get(clone.parentId!) ?? clone.parentId
      }
    }
    this.data.nodes.push(...clones)
    return this.data.nodes.find((n) => n.id === idMap.get(id))!
  }

  async listEmployeesUnder(orgNodeId: string) {
    const ids = new Set(this.subtreeIds(orgNodeId))
    return this.data.employees
      .filter((e) => ids.has(e.orgNodeId) && e.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async listEmployeesDirect(orgNodeId: string) {
    return this.data.employees
      .filter((e) => e.orgNodeId === orgNodeId && e.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async listEmployeesByState(stateCode: number) {
    const orgIds = new Set(
      this.data.nodes.filter((n) => n.domain === 'org' && n.stateCode === stateCode).map((n) => n.id),
    )
    return this.data.employees
      .filter((e) => orgIds.has(e.orgNodeId) && e.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async listAllEmployees() {
    return this.data.employees
      .filter((e) => e.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async listEmployeeDepartments() {
    const byId = new Map(this.data.nodes.map((n) => [n.id, n] as const))
    const deptOf = (nodeId: string): HierNode | undefined => {
      let cur = byId.get(nodeId)
      while (cur && cur.typeKey !== 'department') cur = cur.parentId ? byId.get(cur.parentId) : undefined
      return cur
    }
    const out: Record<string, { id: string; name: string }> = {}
    for (const e of this.data.employees) {
      if (e.status !== 'active') continue
      const dept = deptOf(e.orgNodeId)
      if (dept) out[e.id] = { id: dept.id, name: dept.name }
    }
    return out
  }

  async getEmployee(id: string) {
    return this.data.employees.find((e) => e.id === id)
  }

  async directReports(employeeId: string) {
    return this.data.employees.filter((e) => e.managerId === employeeId && e.status === 'active')
  }

  async reportingChain(employeeId: string) {
    const chain: Employee[] = []
    let cur = this.data.employees.find((e) => e.id === employeeId)
    while (cur?.managerId) {
      const mgr = this.data.employees.find((e) => e.id === cur!.managerId)
      if (!mgr) break
      chain.unshift(mgr)
      cur = mgr
    }
    return chain
  }

  async createEmployee(input: CreateEmployeeInput) {
    const vacant = input.vacant ?? false
    const emp: Employee = {
      id: uid('emp'),
      code: `EMP-NEW-${Math.floor(Math.random() * 9000 + 1000)}`,
      name: input.name,
      designation: input.designation,
      email: input.email,
      phone: input.phone,
      photoUrl: input.photoUrl ?? null,
      orgNodeId: input.orgNodeId,
      managerId: input.managerId,
      vacant,
      connected: vacant ? false : input.connected ?? true,
      relationshipStatus: input.relationshipStatus ?? 'new',
      relationshipQuality: input.relationshipQuality ?? 'neutral',
      relationshipType: input.relationshipType ?? '',
      introducedBy: input.introducedBy ?? '',
      importantContact: input.importantContact ?? false,
      preferredComm: input.preferredComm ?? '',
      lastInteractionAt: input.lastInteractionAt ?? null,
      followUpDate: input.followUpDate ?? null,
      notes: input.notes ?? '',
      charges: input.charges ?? [],
      visitingCards: [],
      metadata: input.metadata ?? {},
      status: 'active',
    }
    this.data.employees.push(emp)
    if (!vacant) {
      this.data.timeline.push({
        id: uid('evt'), employeeId: emp.id, type: 'joined',
        title: `Joined as ${emp.designation || 'employee'}`, date: isoToday(),
        note: '', source: 'system',
      })
    }
    return emp
  }

  async updateEmployee(id: string, patch: Partial<Employee>) {
    const emp = this.data.employees.find((e) => e.id === id)!
    Object.assign(emp, patch)
    return emp
  }

  /** Reassign an employee's reporting manager, rejecting cycles (a person can't
   *  end up reporting to one of their own subordinates). Used by drag-and-drop. */
  async setManager(employeeId: string, managerId: string | null) {
    if (employeeId === managerId) throw new Error('An employee cannot report to themselves')
    const seen = new Set<string>()
    let cur = managerId ? this.data.employees.find((e) => e.id === managerId) : null
    while (cur) {
      if (cur.id === employeeId) throw new Error('That would create a reporting cycle')
      if (seen.has(cur.id)) break
      seen.add(cur.id)
      cur = cur.managerId ? this.data.employees.find((e) => e.id === cur!.managerId) : null
    }
    const emp = this.data.employees.find((e) => e.id === employeeId)!
    emp.managerId = managerId
  }

  async deleteEmployee(id: string) {
    this.data.employees = this.data.employees.filter((e) => e.id !== id)
    this.data.timeline = this.data.timeline.filter((t) => t.employeeId !== id)
    this.data.transfers = this.data.transfers.filter((t) => t.employeeId !== id)
    // Orphaned reports fall back to the removed person's manager.
    const removed = this.data.employees.find((e) => e.id === id)
    for (const e of this.data.employees) {
      if (e.managerId === id) e.managerId = removed?.managerId ?? null
    }
  }

  async listTimeline(employeeId: string) {
    return this.data.timeline
      .filter((t) => t.employeeId === employeeId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  }

  async addTimelineEvent(input: AddTimelineInput) {
    const evt: TimelineEvent = {
      id: uid('evt'), employeeId: input.employeeId, type: input.type,
      title: input.title, date: input.date, time: input.time || undefined,
      note: input.note ?? '', source: 'manual', attendees: input.attendees,
    }
    this.data.timeline.push(evt)
    return evt
  }

  async deleteTimelineEvent(id: string) {
    this.data.timeline = this.data.timeline.filter((t) => t.id !== id)
  }

  async listTransfers(employeeId: string) {
    return this.data.transfers
      .filter((t) => t.employeeId === employeeId)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
  }

  async transferEmployee(input: TransferInput) {
    const emp = this.data.employees.find((e) => e.id === input.employeeId)!
    const fromOffice = this.data.nodes.find((n) => n.id === emp.orgNodeId)
    const toOffice = this.data.nodes.find((n) => n.id === input.toOrgNodeId)
    const deptOf = (nodeId: string | undefined): HierNode | undefined => {
      let cur = nodeId ? this.data.nodes.find((n) => n.id === nodeId) : undefined
      while (cur && cur.typeKey !== 'department') {
        cur = cur.parentId ? this.data.nodes.find((n) => n.id === cur!.parentId) : undefined
      }
      return cur
    }
    const managerName = (id: string | null) => (id ? this.data.employees.find((e) => e.id === id)?.name ?? '—' : '—')
    const managerChanging = input.toManagerId !== undefined
    const transfer: Transfer = {
      id: uid('tr'), employeeId: emp.id,
      fromDesignation: emp.designation, toDesignation: input.toDesignation || emp.designation,
      fromDepartmentName: deptOf(emp.orgNodeId)?.name ?? '—',
      toDepartmentName: deptOf(input.toOrgNodeId)?.name ?? '—',
      fromOfficeName: fromOffice?.name ?? '—',
      toOfficeName: toOffice?.name ?? '—',
      toOrgNodeId: input.toOrgNodeId,
      fromManagerName: managerName(emp.managerId),
      toManagerName: managerChanging ? managerName(input.toManagerId!) : managerName(emp.managerId),
      effectiveDate: input.effectiveDate, reason: input.reason, remarks: input.remarks ?? '',
    }
    this.data.transfers.push(transfer)
    // Apply the posting change to the live record.
    emp.orgNodeId = input.toOrgNodeId
    if (input.toDesignation) emp.designation = input.toDesignation
    // Reporting manager only changes when the caller explicitly set one —
    // otherwise a posting move preserves the existing reporting line.
    if (managerChanging) emp.managerId = input.toManagerId ?? null
    this.data.timeline.push({
      id: uid('evt'), employeeId: emp.id, type: 'transferred',
      title: `Transferred to ${transfer.toOfficeName}`, date: input.effectiveDate,
      note: input.reason, source: 'system',
    })
    return transfer
  }

  async addCharge(employeeId: string, charge: Omit<Charge, 'id'>) {
    const emp = this.data.employees.find((e) => e.id === employeeId)!
    const full: Charge = { ...charge, id: uid('chg') }
    emp.charges = [...emp.charges, full]
    this.data.timeline.push({
      id: uid('evt'), employeeId,
      type: charge.kind === 'acting' ? 'promoted' : 'custom',
      title: `${charge.kind === 'acting' ? 'Acting' : 'Additional'} charge: ${charge.title}`,
      date: charge.startDate ?? isoToday(), note: charge.reason, source: 'system',
    })
    return full
  }

  async removeCharge(employeeId: string, chargeId: string) {
    const emp = this.data.employees.find((e) => e.id === employeeId)!
    emp.charges = emp.charges.filter((c) => c.id !== chargeId)
  }

  /** Natural-language-aware search. Recognises intent keywords ("connected",
   *  "vacant", "transferred", "follow-ups due", cadres like "IAS"), a state
   *  scope by name, and relational phrases ("under X", "reporting to X"), then
   *  falls back to fuzzy matching over names/codes/designations/locations. */
  async search(query: string, stateCode?: number): Promise<SearchResult[]> {
    const raw = query.trim()
    if (!raw) return []
    const q = raw.toLowerCase()
    const nodeById = new Map(this.data.nodes.map((n) => [n.id, n] as const))
    const activeEmps = this.data.employees.filter((e) => e.status === 'active')
    const transferredIds = new Set(this.data.transfers.map((t) => t.employeeId))
    const today = isoToday()

    const empResult = (e: Employee, note?: string): SearchResult => ({
      kind: 'employee', id: e.id,
      title: e.vacant ? `${e.designation || 'Vacant position'} · Vacant` : e.name,
      subtitle: e.designation || nodeById.get(e.orgNodeId)?.name || '—',
      code: e.code, domain: null, stateCode: nodeById.get(e.orgNodeId)?.stateCode ?? null, note,
    })
    const nodeResult = (n: HierNode, note?: string): SearchResult => ({
      kind: 'node', id: n.id, title: n.name,
      subtitle: NODE_TYPE_MAP[n.typeKey]?.label ?? n.typeKey,
      code: n.code, domain: n.domain, stateCode: n.stateCode, note,
    })

    // --- state scope: an explicit state name in the query wins over context ---
    let scopeState = stateCode ?? null
    let scopeName = ''
    for (const s of this.data.nodes.filter((n) => n.typeKey === 'state')) {
      const nm = s.name.toLowerCase()
      if (nm.length >= 3 && q.includes(nm) && nm.length > scopeName.length) {
        scopeState = s.stateCode
        scopeName = nm
      }
    }
    const inScope = (nodeId: string) => scopeState == null || nodeById.get(nodeId)?.stateCode === scopeState

    let rest = scopeName ? q.replace(scopeName, ' ') : q

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
      const container = this.data.nodes.find((n) =>
        n.status === 'active' && n.name.toLowerCase().includes(term) && inScope(n.id))
      if (container) {
        const ids = new Set(this.subtreeIds(container.id))
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
    const cadres = ['ias', 'ips', 'ifs', 'state civil service', 'technical', 'ministerial']
    const cadreHit = cadres.find((c) => q.includes(c))
    const wantVacant = has(/\bvacan/)
    const wantTransferred = has(/\btransfer/)
    const wantNotConnected = has(/\b(not connected|unconnected|no contact)\b/)
    const wantConnected = !wantNotConnected && has(/\bconnected\b/)
    const wantFollowUp = has(/\bfollow[-\s]?ups?\b/)
    const wantImportant = has(/\b(high[-\s]?priority|important|vip|priority)\b/)
    const dueToday = wantFollowUp && has(/\btoday\b/)

    const intentActive = wantVacant || wantTransferred || wantConnected || wantNotConnected
      || wantFollowUp || wantImportant || !!cadreHit

    if (intentActive) {
      // Free-text remainder after stripping recognised keywords, matched
      // against name/designation/office so "collector" in "connected collector"
      // still narrows the set.
      const stop = /\b(connected|unconnected|vacant|vacancy|vacancies|transferred|transfers?|follow[-\s]?ups?|due|today|high|priority|important|vip|officers?|people|show|list|all|in|the|not|no|contact|ias|ips|ifs|state civil service|technical|ministerial)\b/g
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
        if (cadreHit) {
          const cadre = (e.metadata.cadre ?? '').toLowerCase()
          if (cadreHit.length <= 3 ? cadre !== cadreHit : !cadre.includes(cadreHit)) return false
        }
        if (text) {
          const hay = `${e.name} ${e.designation} ${nodeById.get(e.orgNodeId)?.name ?? ''} ${nodeById.get(e.orgNodeId)?.metadata.location ?? ''}`.toLowerCase()
          if (!hay.includes(text)) return false
        }
        return true
      })
      const label = wantVacant ? 'Vacant' : wantTransferred ? 'Transferred'
        : wantFollowUp ? (dueToday ? 'Due today' : 'Follow-up due') : wantImportant ? 'High priority'
        : wantNotConnected ? 'Not connected' : cadreHit ? cadreHit.toUpperCase() : 'Connected'
      return results.slice(0, 24).map((e) => empResult(e, label))
    }

    // --- fuzzy fallback -------------------------------------------------------
    const results: SearchResult[] = []
    for (const n of this.data.nodes) {
      if (n.status !== 'active') continue
      if (scopeState != null && n.stateCode !== scopeState && n.typeKey !== 'state') continue
      const hay = `${n.name} ${n.code ?? ''} ${n.metadata.location ?? ''}`.toLowerCase()
      if (rest.split(/\s+/).every((t) => !t || hay.includes(t))) results.push(nodeResult(n))
      if (results.length > 40) break
    }
    for (const e of activeEmps) {
      if (scopeState != null && nodeById.get(e.orgNodeId)?.stateCode !== scopeState) continue
      const hay = `${e.name} ${e.designation} ${e.code} ${e.metadata.cadre ?? ''}`.toLowerCase()
      if (rest.split(/\s+/).every((t) => !t || hay.includes(t))) results.push(empResult(e))
      if (results.length > 60) break
    }
    return results.slice(0, 24)
  }

  async moveTargets(nodeId: string) {
    const node = this.data.nodes.find((n) => n.id === nodeId)
    if (!node) return []
    const banned = new Set(this.subtreeIds(nodeId))
    return this.data.nodes.filter((c) => {
      if (banned.has(c.id)) return false
      if (c.domain !== node.domain || c.stateCode !== node.stateCode) return false
      if (c.status !== 'active') return false
      const allowed = NODE_TYPE_MAP[c.typeKey]?.childKeys ?? []
      return allowed.length === 0 || allowed.includes(node.typeKey)
    })
  }

  async importChildren(parentId: string, names: string[]) {
    const parent = this.data.nodes.find((n) => n.id === parentId)
    if (!parent) return 0
    const childType = NODE_TYPE_MAP[parent.typeKey]?.childKeys[0] ?? 'district'
    let added = 0
    for (const name of names) {
      const trimmed = name.trim()
      if (!trimmed) continue
      await this.createNode({
        domain: parent.domain, typeKey: childType, parentId,
        stateCode: parent.stateCode, name: trimmed,
      })
      added += 1
    }
    return added
  }

  /** Reorder `id` among its siblings so it sits immediately before `beforeId`
   *  (or last, when `beforeId` is null). Used by drag-and-drop reordering. */
  async reorderNode(id: string, beforeId: string | null) {
    const node = this.data.nodes.find((n) => n.id === id)
    if (!node) return
    const siblings = this.data.nodes
      .filter((n) => n.parentId === node.parentId && n.status === 'active')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    const ordered = siblings.filter((n) => n.id !== id)
    const idx = beforeId ? ordered.findIndex((n) => n.id === beforeId) : -1
    if (idx >= 0) ordered.splice(idx, 0, node)
    else ordered.push(node)
    ordered.forEach((n, i) => { n.sortOrder = i })
  }

  async relationshipAnalytics(): Promise<RelationshipAnalytics> {
    const today = isoToday()
    const active = this.data.employees.filter((e) => e.status === 'active')
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
    const nameById = new Map(this.data.employees.map((e) => [e.id, e] as const))

    const recentInteractions: InteractionSummary[] = this.data.timeline
      .filter((t) => t.source === 'manual' && nameById.get(t.employeeId) && !nameById.get(t.employeeId)!.vacant)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
      .map((t) => ({ employeeId: t.employeeId, name: nameById.get(t.employeeId)!.name, type: t.type, title: t.title, date: t.date }))

    const upcomingFollowUps: FollowUpSummary[] = connected
      .filter((e) => e.followUpDate)
      .sort((a, b) => a.followUpDate!.localeCompare(b.followUpDate!))
      .slice(0, 8)
      .map((e) => ({ employeeId: e.id, name: e.name, designation: e.designation, date: e.followUpDate!, overdue: e.followUpDate! < today }))

    return {
      total: people.length,
      connected: connected.length,
      notConnected: people.length - connected.length,
      vacant: active.filter((e) => e.vacant).length,
      transfers: this.data.transfers.length,
      highPriority: people.filter((e) => e.importantContact).length,
      followUpsDue: connected.filter((e) => e.followUpDate && e.followUpDate <= today).length,
      qualityDist, statusDist, recentInteractions, upcomingFollowUps,
    }
  }
}

export const repository: Repository = new InMemoryRepository()

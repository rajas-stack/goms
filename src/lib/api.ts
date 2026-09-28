import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  repository, type AddTimelineInput, type AssignOwnerInput, type CreateEmployeeInput, type CreateFollowUpInput,
  type CreateNodeInput, type CreateOpportunityInput, type CreateSalesPersonInput, type ImportChildRow,
  type ImportEmployeeRow, type MergeEmployeesInput, type TransferBookOfBusinessInput, type TransferInput,
  type TransferSalesPersonInput,
} from '@/data/repository'
import type {
  Charge, Employee, FollowUp, HierNode, Opportunity, SalesPerson, SearchResult, Status, TimelineEvent, TimelineEventType,
} from './types'

const qk = {
  states: ['states'] as const,
  state: (code: number) => ['state', code] as const,
  node: (id: string) => ['node', id] as const,
  children: (parentId: string) => ['children', parentId] as const,
  orgRoots: (code: number) => ['orgRoots', code] as const,
  breadcrumb: (id: string) => ['breadcrumb', id] as const,
  employeesUnder: (id: string) => ['employeesUnder', id] as const,
  employee: (id: string) => ['employee', id] as const,
  reports: (id: string) => ['reports', id] as const,
  chain: (id: string) => ['chain', id] as const,
  timeline: (id: string) => ['timeline', id] as const,
  allTimelineEvents: (types?: TimelineEventType[]) => ['allTimelineEvents', types ? [...types].sort() : null] as const,
  transfers: (id: string) => ['transfers', id] as const,
  opportunities: ['opportunities'] as const,
  opportunitiesByDepartment: (id: string) => ['opportunitiesByDepartment', id] as const,
  opportunity: (id: string) => ['opportunity', id] as const,
  opportunityStageChanges: (id: string) => ['opportunityStageChanges', id] as const,
  followUps: (entityType: string, entityId: string) => ['followUps', entityType, entityId] as const,
  salesPersons: ['salesPersons'] as const,
  salesPerson: (id: string) => ['salesPerson', id] as const,
  salesPostings: (id: string) => ['salesPostings', id] as const,
  currentPostings: ['currentPostings'] as const,
  ownershipFor: (t: string, id: string) => ['ownershipFor', t, id] as const,
  ownedBy: (id: string, asOf: string) => ['ownedBy', id, asOf] as const,
  resolvedOwners: (t: string, asOf: string, ids: string[]) => ['resolvedOwners', t, asOf, ids] as const,
  openFollowUps: ['openFollowUps'] as const,
}

export const useStates = () => useQuery({ queryKey: qk.states, queryFn: () => repository.listStates() })
// `code: -1` is the Directory sentinel (never a real state or the Government
// of India's stateCode 0) — disabled rather than queried, so a consumer
// passed the sentinel doesn't fire a query with no matching node, which
// react-query rejects (queryFn must not return undefined).
// The three lookups below can legitimately miss — a reload or a shared link
// can carry an id/code that no longer resolves (a deleted record, a stale
// `?sel=`, a hand-edited URL). Their repository methods return `undefined` for
// that, which react-query treats as a programming error and throws on
// ("Query data cannot be undefined"), so each normalizes to `null`: a real,
// cacheable "looked, found nothing" that the UI renders as an empty state.
// `undefined` still means "not loaded yet", as everywhere else.
export const useStateNode = (code: number) =>
  useQuery({ queryKey: qk.state(code), queryFn: async () => (await repository.getState(code)) ?? null, enabled: code >= 0 })
export const useNode = (id: string | null) =>
  useQuery({ queryKey: qk.node(id ?? ''), queryFn: async () => (await repository.getNode(id!)) ?? null, enabled: !!id })
export const useChildren = (parentId: string | null) =>
  useQuery({ queryKey: qk.children(parentId ?? ''), queryFn: () => repository.listChildren(parentId!), enabled: !!parentId })
export const useOrgRoots = (code: number) =>
  useQuery({ queryKey: qk.orgRoots(code), queryFn: () => repository.listOrgRoots(code) })
export const useDepartments = () =>
  useQuery({ queryKey: ['departments'], queryFn: () => repository.listDepartments() })
export const useChildCounts = (parentId: string | null) =>
  useQuery({ queryKey: ['childCounts', parentId ?? ''], queryFn: () => repository.childCounts(parentId!), enabled: !!parentId })
export const usePostingNodes = (code: number | null) =>
  useQuery({ queryKey: ['postingNodes', code ?? -1], queryFn: () => repository.listPostingNodes(code!), enabled: code != null })
export const useBreadcrumb = (id: string | null) =>
  useQuery({ queryKey: qk.breadcrumb(id ?? ''), queryFn: () => repository.breadcrumb(id!), enabled: !!id })
export const useEmployeesUnder = (orgNodeId: string | null) =>
  useQuery({ queryKey: qk.employeesUnder(orgNodeId ?? ''), queryFn: () => repository.listEmployeesUnder(orgNodeId!), enabled: !!orgNodeId })
export const useEmployeesDirect = (orgNodeId: string | null) =>
  useQuery({ queryKey: ['employeesDirect', orgNodeId ?? ''], queryFn: () => repository.listEmployeesDirect(orgNodeId!), enabled: !!orgNodeId })
export const useEmployeesByState = (code: number) =>
  useQuery({ queryKey: ['employeesByState', code], queryFn: () => repository.listEmployeesByState(code) })
export const useAllEmployees = () =>
  useQuery({ queryKey: ['allEmployees'], queryFn: () => repository.listAllEmployees() })
export const useEmployeeDepartments = () =>
  useQuery({ queryKey: ['employeeDepartments'], queryFn: () => repository.listEmployeeDepartments() })
export const useRelationshipAnalytics = () =>
  useQuery({ queryKey: ['relationshipAnalytics'], queryFn: () => repository.relationshipAnalytics() })
export const useEmployee = (id: string | null) =>
  useQuery({ queryKey: qk.employee(id ?? ''), queryFn: () => repository.getEmployee(id!), enabled: !!id })
export const useDirectReports = (id: string | null) =>
  useQuery({ queryKey: qk.reports(id ?? ''), queryFn: () => repository.directReports(id!), enabled: !!id })
export const useReportingChain = (id: string | null) =>
  useQuery({ queryKey: qk.chain(id ?? ''), queryFn: () => repository.reportingChain(id!), enabled: !!id })
export const useTimeline = (id: string | null) =>
  useQuery({ queryKey: qk.timeline(id ?? ''), queryFn: () => repository.listTimeline(id!), enabled: !!id })
/** Cross-employee timeline events (Meetings screen), optionally
 *  narrowed to a set of event types. */
export const useAllTimelineEvents = (filter?: { types?: TimelineEventType[] }) =>
  useQuery({
    queryKey: qk.allTimelineEvents(filter?.types),
    queryFn: () => repository.listAllTimelineEvents(filter),
  })
export const useTransfers = (id: string | null) =>
  useQuery({ queryKey: qk.transfers(id ?? ''), queryFn: () => repository.listTransfers(id!), enabled: !!id })
export const useOpportunities = () =>
  useQuery({ queryKey: qk.opportunities, queryFn: () => repository.listOpportunities() })
export const useOpportunitiesByDepartment = (departmentId: string | null) =>
  useQuery({
    queryKey: qk.opportunitiesByDepartment(departmentId ?? ''),
    queryFn: () => repository.listOpportunitiesByDepartment(departmentId!),
    enabled: !!departmentId,
  })

export function useOpportunityMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['opportunities'] })
    qc.invalidateQueries({ queryKey: ['opportunitiesByDepartment'] })
    qc.invalidateQueries({ queryKey: ['opportunity'] })
    qc.invalidateQueries({ queryKey: ['opportunityStageChanges'] })
  }
  const create = useMutation({ mutationFn: (i: CreateOpportunityInput) => repository.createOpportunity(i), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Opportunity> }) => repository.updateOpportunity(a.id, a.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteOpportunity(id), onSuccess: invalidate })
  return { create, update, remove }
}

export const useSalesPersons = () =>
  useQuery({ queryKey: qk.salesPersons, queryFn: () => repository.listSalesPersons() })
export const useSalesPerson = (id: string | null) =>
  useQuery({ queryKey: qk.salesPerson(id ?? ''), queryFn: () => repository.getSalesPerson(id!), enabled: !!id })
export const useSalesPostings = (id: string | null) =>
  useQuery({ queryKey: qk.salesPostings(id ?? ''), queryFn: () => repository.listSalesPostings(id!), enabled: !!id })
export const useCurrentPostings = () =>
  useQuery({ queryKey: qk.currentPostings, queryFn: () => repository.currentPostings() })

export function useSalesPersonMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['salesPersons'] })
    qc.invalidateQueries({ queryKey: ['salesPerson'] })
    qc.invalidateQueries({ queryKey: ['salesPostings'] })
    qc.invalidateQueries({ queryKey: ['currentPostings'] })
  }
  const create = useMutation({ mutationFn: (i: CreateSalesPersonInput) => repository.createSalesPerson(i), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<SalesPerson> }) => repository.updateSalesPerson(a.id, a.patch),
    onSuccess: invalidate,
  })
  const setStatus = useMutation({
    mutationFn: (a: { id: string; status: SalesPerson['status'] }) => repository.setSalesPersonStatus(a.id, a.status),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteSalesPerson(id), onSuccess: invalidate })
  const transfer = useMutation({
    mutationFn: (i: TransferSalesPersonInput) => repository.transferSalesPerson(i),
    onSuccess: invalidate,
  })
  const updatePostingManager = useMutation({
    mutationFn: (a: { personId: string; managerId?: string | null; gmOverrideId?: string | null }) => {
      const { personId, ...patch } = a
      return repository.updatePostingManager(personId, patch)
    },
    onSuccess: invalidate,
  })
  return { create, update, setStatus, remove, transfer, updatePostingManager }
}

export const useOwnershipAssignments = () =>
  useQuery({ queryKey: ['ownershipAssignments'], queryFn: () => repository.listOwnershipAssignments() })

export const useOwnershipFor = (entityType: string, entityId: string | null) =>
  useQuery({
    queryKey: qk.ownershipFor(entityType, entityId ?? ''),
    queryFn: () => repository.listOwnershipFor(entityType, entityId!),
    enabled: !!entityId,
  })
export const useOwnedBy = (salesPersonId: string | null, asOf: string) =>
  useQuery({
    queryKey: qk.ownedBy(salesPersonId ?? '', asOf),
    queryFn: () => repository.listOwnedBy(salesPersonId!, asOf),
    enabled: !!salesPersonId,
  })
/** Batch owner resolution for a list. `ids` is part of the key, so a changed
 *  list refetches rather than showing a stale map. */
export const useResolvedOwners = (entityType: string, ids: string[], asOf: string) =>
  useQuery({
    queryKey: qk.resolvedOwners(entityType, asOf, ids),
    queryFn: () => repository.resolveOwners(entityType, ids, asOf),
    enabled: ids.length > 0,
  })

export function useOwnershipMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ownershipFor'] })
    qc.invalidateQueries({ queryKey: ['ownedBy'] })
    qc.invalidateQueries({ queryKey: ['resolvedOwners'] })
    qc.invalidateQueries({ queryKey: ['ownershipAssignments'] })
  }
  const assign = useMutation({ mutationFn: (i: AssignOwnerInput) => repository.assignOwner(i), onSuccess: invalidate })
  const end = useMutation({
    mutationFn: (a: { id: string; endDate: string }) => repository.endOwnership(a.id, a.endDate),
    onSuccess: invalidate,
  })
  const transferBookOfBusiness = useMutation({
    mutationFn: (i: TransferBookOfBusinessInput) => repository.transferBookOfBusiness(i),
    onSuccess: invalidate,
  })
  return { assign, end, transferBookOfBusiness }
}

export const useFollowUps = (entityType: string, entityId: string | null) =>
  useQuery({
    queryKey: qk.followUps(entityType, entityId ?? ''),
    queryFn: () => repository.listFollowUps(entityType, entityId!),
    enabled: !!entityId,
  })
/** Every open follow-up across every entity — used by Sales Team Insights'
 *  "open follow-ups by assignee" metric, not scoped to one entity. */
export const useOpenFollowUps = () =>
  useQuery({ queryKey: qk.openFollowUps, queryFn: () => repository.listOpenFollowUps() })

export function useFollowUpMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['followUps'] })
    qc.invalidateQueries({ queryKey: ['openFollowUps'] })
  }
  const create = useMutation({ mutationFn: (i: CreateFollowUpInput) => repository.createFollowUp(i), onSuccess: invalidate })
  const setStatus = useMutation({
    mutationFn: (a: { id: string; status: FollowUp['status'] }) => repository.setFollowUpStatus(a.id, a.status),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteFollowUp(id), onSuccess: invalidate })
  return { create, setStatus, remove }
}

export const useMoveTargets = (nodeId: string | null) =>
  useQuery({ queryKey: ['moveTargets', nodeId ?? ''], queryFn: () => repository.moveTargets(nodeId!), enabled: !!nodeId })

export function useSearch(query: string, stateCode?: number) {
  return useQuery({
    queryKey: ['search', query, stateCode ?? null],
    queryFn: () => repository.search(query, stateCode),
    enabled: query.trim().length > 0,
  })
}

/** Lazy — only fetches once a palette row is actually expanded (`result`
 *  becomes non-null), never for every visible row up front. */
export function useRelatedRecords(result: SearchResult | null) {
  return useQuery({
    queryKey: ['relatedRecords', result?.category ?? '', result?.id ?? ''],
    queryFn: () => repository.relatedRecords(result!),
    enabled: !!result,
  })
}

function useInvalidateTree() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['children'] })
    qc.invalidateQueries({ queryKey: ['orgRoots'] })
    qc.invalidateQueries({ queryKey: ['departments'] })
    qc.invalidateQueries({ queryKey: ['node'] })
    qc.invalidateQueries({ queryKey: ['states'] })
    qc.invalidateQueries({ queryKey: ['employeesUnder'] })
    qc.invalidateQueries({ queryKey: ['employeeDepartments'] })
  }
}

export function useNodeMutations() {
  const invalidate = useInvalidateTree()
  const create = useMutation({ mutationFn: (i: CreateNodeInput) => repository.createNode(i), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Pick<HierNode, 'name' | 'metadata'>> }) => repository.updateNode(a.id, a.patch),
    onSuccess: invalidate,
  })
  const setStatus = useMutation({
    mutationFn: (a: { id: string; status: Status }) => repository.setNodeStatus(a.id, a.status),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteNode(id), onSuccess: invalidate })
  const move = useMutation({
    mutationFn: (a: { id: string; newParentId: string | null }) => repository.moveNode(a.id, a.newParentId),
    onSuccess: invalidate,
  })
  const duplicate = useMutation({ mutationFn: (id: string) => repository.duplicateNode(id), onSuccess: invalidate })
  const importChildren = useMutation({
    mutationFn: (a: { parentId: string; rows: ImportChildRow[] }) => repository.importChildren(a.parentId, a.rows),
    onSuccess: invalidate,
  })
  const reorder = useMutation({
    mutationFn: (a: { id: string; beforeId: string | null }) => repository.reorderNode(a.id, a.beforeId),
    onSuccess: invalidate,
  })
  return { create, update, setStatus, remove, move, duplicate, importChildren, reorder }
}

export function useEmployeeMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['employeesUnder'] })
    qc.invalidateQueries({ queryKey: ['employeesDirect'] })
    qc.invalidateQueries({ queryKey: ['employeesByState'] })
    qc.invalidateQueries({ queryKey: ['allEmployees'] })
    qc.invalidateQueries({ queryKey: ['employeeDepartments'] })
    qc.invalidateQueries({ queryKey: ['employee'] })
    qc.invalidateQueries({ queryKey: ['reports'] })
    qc.invalidateQueries({ queryKey: ['chain'] })
    qc.invalidateQueries({ queryKey: ['states'] })
    qc.invalidateQueries({ queryKey: ['timeline'] })
    qc.invalidateQueries({ queryKey: ['allTimelineEvents'] })
    qc.invalidateQueries({ queryKey: ['transfers'] })
    qc.invalidateQueries({ queryKey: ['relationshipAnalytics'] })
  }
  const create = useMutation({ mutationFn: (i: CreateEmployeeInput) => repository.createEmployee(i), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Employee> }) => repository.updateEmployee(a.id, a.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteEmployee(id), onSuccess: invalidate })
  const setManager = useMutation({
    mutationFn: (a: { employeeId: string; managerId: string | null }) => repository.setManager(a.employeeId, a.managerId),
    onSuccess: invalidate,
  })
  const addTimelineEvent = useMutation({
    mutationFn: (i: AddTimelineInput) => repository.addTimelineEvent(i), onSuccess: invalidate,
  })
  const updateTimelineEvent = useMutation({
    mutationFn: (a: { id: string; patch: Partial<TimelineEvent> }) => repository.updateTimelineEvent(a.id, a.patch),
    onSuccess: invalidate,
  })
  const deleteTimelineEvent = useMutation({
    mutationFn: (id: string) => repository.deleteTimelineEvent(id), onSuccess: invalidate,
  })
  const setTimelineEventAttended = useMutation({
    mutationFn: (a: { id: string; attended: boolean | undefined }) => repository.setTimelineEventAttended(a.id, a.attended),
    onSuccess: invalidate,
  })
  const transfer = useMutation({
    mutationFn: (i: TransferInput) => repository.transferEmployee(i), onSuccess: invalidate,
  })
  const addCharge = useMutation({
    mutationFn: (a: { employeeId: string; charge: Omit<Charge, 'id'> }) => repository.addCharge(a.employeeId, a.charge),
    onSuccess: invalidate,
  })
  const removeCharge = useMutation({
    mutationFn: (a: { employeeId: string; chargeId: string }) => repository.removeCharge(a.employeeId, a.chargeId),
    onSuccess: invalidate,
  })
  const importEmployees = useMutation({
    mutationFn: (a: { orgNodeId: string; rows: ImportEmployeeRow[] }) => repository.importEmployees(a.orgNodeId, a.rows),
    onSuccess: invalidate,
  })
  const merge = useMutation({
    mutationFn: (i: MergeEmployeesInput) => repository.mergeEmployees(i),
    onSuccess: () => {
      invalidate()
      // A merge can also repoint a department's `deptHead` metadata at the
      // survivor — the tree/department queries the shared `invalidate` above
      // doesn't touch need refreshing too.
      qc.invalidateQueries({ queryKey: ['node'] })
      qc.invalidateQueries({ queryKey: ['children'] })
      qc.invalidateQueries({ queryKey: ['departments'] })
      qc.invalidateQueries({ queryKey: ['mergeAudit'] })
    },
  })
  return {
    create, update, remove, setManager, addTimelineEvent, updateTimelineEvent, deleteTimelineEvent, setTimelineEventAttended,
    transfer, addCharge, removeCharge, importEmployees, merge,
  }
}

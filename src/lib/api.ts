import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  repository, type AddTimelineInput, type CreateEmployeeInput, type CreateNodeInput,
  type TransferInput,
} from '@/data/repository'
import type { Charge, Employee, HierNode, Status } from './types'

export const qk = {
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
  transfers: (id: string) => ['transfers', id] as const,
}

export const useStates = () => useQuery({ queryKey: qk.states, queryFn: () => repository.listStates() })
export const useStateNode = (code: number) =>
  useQuery({ queryKey: qk.state(code), queryFn: () => repository.getState(code) })
export const useNode = (id: string | null) =>
  useQuery({ queryKey: qk.node(id ?? ''), queryFn: () => repository.getNode(id!), enabled: !!id })
export const useChildren = (parentId: string | null) =>
  useQuery({ queryKey: qk.children(parentId ?? ''), queryFn: () => repository.listChildren(parentId!), enabled: !!parentId })
export const useOrgRoots = (code: number) =>
  useQuery({ queryKey: qk.orgRoots(code), queryFn: () => repository.listOrgRoots(code) })
export const useGeoRoot = () =>
  useQuery({ queryKey: ['geoRoot'], queryFn: () => repository.geoRoot() })
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
export const useTransfers = (id: string | null) =>
  useQuery({ queryKey: qk.transfers(id ?? ''), queryFn: () => repository.listTransfers(id!), enabled: !!id })

export const useMoveTargets = (nodeId: string | null) =>
  useQuery({ queryKey: ['moveTargets', nodeId ?? ''], queryFn: () => repository.moveTargets(nodeId!), enabled: !!nodeId })

export function useSearch(query: string, stateCode?: number) {
  return useQuery({
    queryKey: ['search', query, stateCode ?? null],
    queryFn: () => repository.search(query, stateCode),
    enabled: query.trim().length > 0,
  })
}

function useInvalidateTree() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['children'] })
    qc.invalidateQueries({ queryKey: ['orgRoots'] })
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
    mutationFn: (a: { parentId: string; names: string[] }) => repository.importChildren(a.parentId, a.names),
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
  const deleteTimelineEvent = useMutation({
    mutationFn: (id: string) => repository.deleteTimelineEvent(id), onSuccess: invalidate,
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
  return { create, update, remove, setManager, addTimelineEvent, deleteTimelineEvent, transfer, addCharge, removeCharge }
}

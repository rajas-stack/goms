// Additive, tRPC-backed Repository implementation — only wired in when
// VITE_API_BASE_URL is set (see ../repository.ts). Implements Partial<Repository>
// so any other method call is simply absent (undefined) rather than needing
// ~100 hand-written throwing stubs; nothing routes through this today.
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'
import type {
  Repository, CreateCustomerInput, CreateNodeInput, CreateEmployeeInput, AddTimelineInput,
  ImportChildRow, ImportEmployeeRow, MergeEmployeesInput, TransferInput, StateSummary,
} from '../repository'
import type {
  Customer, HierNode, Status, Employee, Charge, TimelineEvent, TimelineEventType, Transfer, MergeAuditRecord,
} from '@/lib/types'

export class RemoteRepository implements Partial<Repository> {
  private client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc` })],
  })

  listCustomers = (): Promise<Customer[]> => this.client.customers.list.query()
  getCustomer = (id: string): Promise<Customer | null> => this.client.customers.get.query({ id })
  createCustomer = (input: CreateCustomerInput): Promise<Customer> =>
    this.client.customers.create.mutate(input)
  updateCustomer = (id: string, patch: Partial<Customer>): Promise<Customer> =>
    this.client.customers.update.mutate({ id, patch, expectedUpdatedAt: patch.updatedAt })
  deleteCustomer = (id: string): Promise<void> => this.client.customers.delete.mutate({ id })

  listStates = (): Promise<StateSummary[]> => this.client.hierarchy.listStates.query()
  getState = (code: number): Promise<HierNode | undefined> =>
    this.client.hierarchy.getState.query({ code }).then((r) => r ?? undefined)
  getNode = (id: string): Promise<HierNode | undefined> =>
    this.client.hierarchy.getNode.query({ id }).then((r) => r ?? undefined)
  listChildren = (parentId: string): Promise<HierNode[]> => this.client.hierarchy.listChildren.query({ parentId })
  listOrgRoots = (stateCode: number): Promise<HierNode[]> => this.client.hierarchy.listOrgRoots.query({ stateCode })
  listDepartments = (): Promise<HierNode[]> => this.client.hierarchy.listDepartments.query()
  listPostingNodes = (stateCode: number): Promise<HierNode[]> => this.client.hierarchy.listPostingNodes.query({ stateCode })
  breadcrumb = (id: string): Promise<HierNode[]> => this.client.hierarchy.breadcrumb.query({ id })
  childCount = (id: string): Promise<number> => this.client.hierarchy.childCount.query({ id })
  geoRoot = (): Promise<HierNode | undefined> => this.client.hierarchy.geoRoot.query().then((r) => r ?? undefined)
  childCounts = (parentId: string): Promise<Record<string, number>> => this.client.hierarchy.childCounts.query({ parentId })
  createNode = (input: CreateNodeInput): Promise<HierNode> => this.client.hierarchy.createNode.mutate(input)
  updateNode = (id: string, patch: Partial<Pick<HierNode, 'name' | 'metadata'>>): Promise<HierNode> =>
    this.client.hierarchy.updateNode.mutate({ id, patch })
  setNodeStatus = (id: string, status: Status): Promise<void> => this.client.hierarchy.setNodeStatus.mutate({ id, status })
  deleteNode = (id: string): Promise<void> => this.client.hierarchy.deleteNode.mutate({ id })
  moveNode = (id: string, newParentId: string | null): Promise<void> =>
    this.client.hierarchy.moveNode.mutate({ id, newParentId })
  duplicateNode = (id: string): Promise<HierNode> => this.client.hierarchy.duplicateNode.mutate({ id })
  importChildren = (parentId: string, rows: ImportChildRow[]): Promise<number> =>
    this.client.hierarchy.importChildren.mutate({ parentId, rows })
  moveTargets = (nodeId: string): Promise<HierNode[]> => this.client.hierarchy.moveTargets.query({ nodeId })
  reorderNode = (id: string, beforeId: string | null): Promise<void> =>
    this.client.hierarchy.reorderNode.mutate({ id, beforeId })

  listEmployeesUnder = (orgNodeId: string): Promise<Employee[]> => this.client.employees.listUnder.query({ orgNodeId })
  listEmployeesDirect = (orgNodeId: string): Promise<Employee[]> => this.client.employees.listDirect.query({ orgNodeId })
  listEmployeesByState = (stateCode: number): Promise<Employee[]> => this.client.employees.listByState.query({ stateCode })
  listAllEmployees = (): Promise<Employee[]> => this.client.employees.listAll.query()
  listEmployeeDepartments = (): Promise<Record<string, { id: string; name: string }>> => this.client.employees.listDepartments.query()
  getEmployee = (id: string): Promise<Employee | null> => this.client.employees.get.query({ id })
  directReports = (employeeId: string): Promise<Employee[]> => this.client.employees.directReports.query({ employeeId })
  reportingChain = (employeeId: string): Promise<Employee[]> => this.client.employees.reportingChain.query({ employeeId })
  createEmployee = (input: CreateEmployeeInput): Promise<Employee> =>
    this.client.employees.create.mutate({ ...input, charges: input.charges?.map(({ id: _id, ...rest }) => rest) })
  updateEmployee = (id: string, patch: Partial<Employee>): Promise<Employee> =>
    this.client.employees.update.mutate({ id, patch: patch as any }).then((r) => r!)
  setManager = (employeeId: string, managerId: string | null): Promise<void> =>
    this.client.employees.setManager.mutate({ employeeId, managerId })
  deleteEmployee = (id: string): Promise<void> => this.client.employees.delete.mutate({ id })
  mergeEmployees = (input: MergeEmployeesInput): Promise<{ survivor: Employee; audit: MergeAuditRecord }> =>
    this.client.employees.merge.mutate(input as any)
  listMergeAudit = (): Promise<MergeAuditRecord[]> => this.client.employees.listMergeAudit.query()
  addCharge = (employeeId: string, charge: Omit<Charge, 'id'>): Promise<Charge> =>
    this.client.employees.addCharge.mutate({ employeeId, charge })
  removeCharge = (employeeId: string, chargeId: string): Promise<void> =>
    this.client.employees.removeCharge.mutate({ employeeId, chargeId })
  importEmployees = (orgNodeId: string, rows: ImportEmployeeRow[]): Promise<number> =>
    this.client.employees.import.mutate({ orgNodeId, rows })

  listTimeline = (employeeId: string): Promise<TimelineEvent[]> => this.client.employees.timeline.listForEmployee.query({ employeeId })
  listAllTimelineEvents = (filter?: { types?: TimelineEventType[] }): Promise<TimelineEvent[]> =>
    this.client.employees.timeline.listAll.query(filter)
  addTimelineEvent = (input: AddTimelineInput): Promise<TimelineEvent> => this.client.employees.timeline.add.mutate(input)
  setTimelineEventAttended = (id: string, attended: boolean | undefined): Promise<void> =>
    this.client.employees.timeline.setAttended.mutate({ id, attended })
  deleteTimelineEvent = (id: string): Promise<void> => this.client.employees.timeline.delete.mutate({ id })

  listTransfers = (employeeId: string): Promise<Transfer[]> => this.client.employees.transfers.listForEmployee.query({ employeeId })
  transferEmployee = (input: TransferInput): Promise<Transfer> => this.client.employees.transfers.transfer.mutate(input)
}

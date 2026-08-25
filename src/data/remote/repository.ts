// Additive, tRPC-backed Repository implementation — only wired in when
// VITE_API_BASE_URL is set (see ../repository.ts). Implements Partial<Repository>
// so any other method call is simply absent (undefined) rather than needing
// ~100 hand-written throwing stubs; nothing routes through this today.
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'
import type {
  Repository, CreateCustomerInput, CreateNodeInput, CreateEmployeeInput, AddTimelineInput,
  ImportChildRow, ImportEmployeeRow, MergeEmployeesInput, TransferInput,
  CreateSalesPersonInput, TransferSalesPersonInput, StateSummary,
} from '../repository'
import type {
  Customer, HierNode, Status, Employee, Charge, TimelineEvent, TimelineEventType, Transfer, MergeAuditRecord,
  SalesPerson, SalesPosting,
} from '@/lib/types'
import type {
  CommercialBomItem, CommercialSku, CreateBomItemInput, CreateSkuInput,
  MasterEntityKey, MasterRowMap, CreateMasterInput, ProductEditionFeature,
  CommercialBoq, CommercialBoqLineItem, CommercialAuditLog, CreateBoqInput, UpdateBoqInput, CreateBoqLineItemInput, BoqStatus,
} from '@/modules/commercial-calculator/types'

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

  listSalesPersons = (): Promise<SalesPerson[]> => this.client.sales.listPersons.query()
  getSalesPerson = (id: string): Promise<SalesPerson | null> => this.client.sales.getPerson.query({ id })
  listSalesPostings = (salesPersonId: string): Promise<SalesPosting[]> => this.client.sales.listPostings.query({ salesPersonId })
  currentPostings = (): Promise<Record<string, SalesPosting>> => this.client.sales.currentPostings.query()
  createSalesPerson = (input: CreateSalesPersonInput): Promise<SalesPerson> => this.client.sales.create.mutate(input)
  updateSalesPerson = (id: string, patch: Partial<SalesPerson>): Promise<SalesPerson> =>
    this.client.sales.update.mutate({ id, patch: patch as any }).then((r) => r!)
  setSalesPersonStatus = (id: string, status: SalesPerson['status']): Promise<void> => this.client.sales.setStatus.mutate({ id, status })
  deleteSalesPerson = (id: string): Promise<void> => this.client.sales.delete.mutate({ id })
  transferSalesPerson = (input: TransferSalesPersonInput): Promise<SalesPosting> => this.client.sales.transfer.mutate(input)

  listMaster = <K extends MasterEntityKey>(key: K): Promise<MasterRowMap[K][]> =>
    this.client.commercial.masters.list.query({ key }) as unknown as Promise<MasterRowMap[K][]>
  getMaster = <K extends MasterEntityKey>(key: K, id: string): Promise<MasterRowMap[K] | null> =>
    this.client.commercial.masters.get.query({ key, id }) as unknown as Promise<MasterRowMap[K] | null>
  createMaster = <K extends MasterEntityKey>(key: K, input: CreateMasterInput<K>): Promise<MasterRowMap[K]> =>
    this.client.commercial.masters.create.mutate({ key, input } as any) as unknown as Promise<MasterRowMap[K]>
  updateMaster = <K extends MasterEntityKey>(
    key: K, id: string, patch: Partial<MasterRowMap[K]>, changeReason?: string,
  ): Promise<MasterRowMap[K]> =>
    this.client.commercial.masters.update.mutate({ key, id, patch, changeReason } as any).then((r) => r as unknown as MasterRowMap[K])
  setMasterActive = (key: MasterEntityKey, id: string, active: boolean): Promise<void> =>
    this.client.commercial.masters.setActive.mutate({ key, id, active })
  deleteMaster = (key: MasterEntityKey, id: string): Promise<void> =>
    this.client.commercial.masters.delete.mutate({ key, id })
  listEditionFeatures = (editionId: string): Promise<ProductEditionFeature[]> =>
    this.client.commercial.masters.listEditionFeatures.query({ editionId })
  setEditionFeatures = (editionId: string, rows: { featureId: string; mandatory: boolean }[]): Promise<void> =>
    this.client.commercial.masters.setEditionFeatures.mutate({ editionId, rows })

  listSkus = (): Promise<CommercialSku[]> => this.client.commercial.skus.list.query() as unknown as Promise<CommercialSku[]>
  getSku = (id: string): Promise<CommercialSku | null> =>
    this.client.commercial.skus.get.query({ id }) as unknown as Promise<CommercialSku | null>
  createSku = (input: CreateSkuInput): Promise<CommercialSku> =>
    this.client.commercial.skus.create.mutate(input as any) as unknown as Promise<CommercialSku>
  updateSku = (id: string, patch: Partial<CommercialSku>, changeReason?: string): Promise<CommercialSku> =>
    this.client.commercial.skus.update.mutate({ id, patch: patch as any, changeReason }) as unknown as Promise<CommercialSku>
  deleteSku = (id: string): Promise<void> => this.client.commercial.skus.delete.mutate({ id })

  listBomItemsForSku = (parentSkuId: string): Promise<CommercialBomItem[]> =>
    this.client.commercial.bom.listForSku.query({ parentSkuId })
  listAllBomItems = (): Promise<CommercialBomItem[]> => this.client.commercial.bom.listAll.query()
  createBomItem = (input: CreateBomItemInput): Promise<CommercialBomItem> => this.client.commercial.bom.create.mutate(input)
  updateBomItem = (id: string, patch: Partial<CommercialBomItem>): Promise<CommercialBomItem> =>
    this.client.commercial.bom.update.mutate({ id, patch })
  deleteBomItem = (id: string): Promise<void> => this.client.commercial.bom.delete.mutate({ id })

  listBoqs = (): Promise<CommercialBoq[]> => this.client.commercial.boq.list.query()
  getBoq = (id: string): Promise<CommercialBoq | null> => this.client.commercial.boq.get.query({ id })
  listBoqLineItems = (boqId: string): Promise<CommercialBoqLineItem[]> => this.client.commercial.boq.listLineItems.query({ boqId })
  listAllBoqLineItems = (): Promise<CommercialBoqLineItem[]> => this.client.commercial.boq.listAllLineItems.query()
  createBoq = (input: CreateBoqInput): Promise<CommercialBoq> => this.client.commercial.boq.create.mutate(input)
  updateBoq = (id: string, patch: UpdateBoqInput): Promise<CommercialBoq> => this.client.commercial.boq.update.mutate({ id, patch })
  addBoqLineItem = (boqId: string, input: CreateBoqLineItemInput): Promise<CommercialBoqLineItem> =>
    this.client.commercial.boq.addLineItem.mutate({ boqId, ...input })
  updateBoqLineItem = (
    id: string,
    patch: Partial<Pick<CommercialBoqLineItem,
      'quantity' | 'unitPrice' | 'discountPct' | 'approverId' | 'approvalDate' | 'approvalRemarks' | 'approvalStatus'
      | 'pricingLevels' | 'activePricingLevel'
    >>,
  ): Promise<CommercialBoqLineItem> => this.client.commercial.boq.updateLineItem.mutate({ id, patch })
  removeBoqLineItem = (id: string): Promise<void> => this.client.commercial.boq.removeLineItem.mutate({ id })
  reorderBoqLineItems = (boqId: string, orderedIds: string[]): Promise<void> =>
    this.client.commercial.boq.reorderLineItems.mutate({ boqId, orderedIds })
  updateBoqStatus = (id: string, nextStatus: BoqStatus, changeReason: string): Promise<CommercialBoq> =>
    this.client.commercial.boq.updateStatus.mutate({ id, nextStatus, changeReason })
  reviseBoq = (id: string): Promise<CommercialBoq> => this.client.commercial.boq.revise.mutate({ id })
  duplicateBoq = (id: string): Promise<CommercialBoq> => this.client.commercial.boq.duplicate.mutate({ id })
  deleteBoq = (id: string): Promise<void> => this.client.commercial.boq.delete.mutate({ id })

  listAuditLogs = (filter?: { entityType?: string; entityId?: string }): Promise<CommercialAuditLog[]> =>
    this.client.commercial.auditLogs.list.query(filter)
}

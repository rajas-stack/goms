import type { Repository } from './in-memory/repository'
import { repository as inMemoryRepository } from './in-memory/repository'
import { listOrgRoots, listDepartments, listPostingNodes } from './supabase/departments'
import { getState, geoRoot, childCounts, listStates } from './supabase/geography'
import {
  getNode, listChildren, breadcrumb, childCount, createNode, updateNode,
  setNodeStatus, deleteNode, moveNode, duplicateNode, reorderNode, importChildren, moveTargets,
} from './supabase/hierarchy'
import {
  listEmployeesUnder, listEmployeesDirect, listEmployeesByState, listAllEmployees, listEmployeeDepartments,
  getEmployee, directReports, reportingChain, listTimeline, listAllTimelineEvents, listTransfers, listMergeAudit,
  createEmployee, updateEmployee, setManager, deleteEmployee, mergeEmployees, addTimelineEvent,
  setTimelineEventAttended, deleteTimelineEvent, transferEmployee, addCharge, removeCharge, importEmployees,
} from './supabase/employees'
import { listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer } from './supabase/customers'
import {
  createSalesPerson, updateSalesPerson, setSalesPersonStatus, deleteSalesPerson, transferSalesPerson,
  listSalesPersons, getSalesPerson, listSalesPostings, currentPostings,
} from './supabase/sales-people'
import {
  createOpportunity, updateOpportunity, deleteOpportunity, createFollowUp, setFollowUpStatus, deleteFollowUp,
  assignOwner, endOwnership, transferBookOfBusiness, listOpportunities, listOpportunitiesByDepartment,
  getOpportunity, listOpportunityStageChanges, listFollowUps, listOpenFollowUps, listOwnershipAssignments,
  listOwnershipFor, listOwnedBy, resolveOwner, resolveOwners,
} from './supabase/ownership'
import {
  listMaster, getMaster, createMaster, updateMaster, setMasterActive, deleteMaster,
  listEditionFeatures, setEditionFeatures,
} from './supabase/commercial-masters'
import { listSkus, getSku, createSku, updateSku, deleteSku } from './supabase/commercial-skus'
import { listBomItemsForSku, listAllBomItems, createBomItem, updateBomItem, deleteBomItem } from './supabase/commercial-bom'

/** One bucket per independently-migratable slice of the Repository interface.
 *  `hierarchy` is not `departments` or `geography`: it holds the handful of
 *  methods that are id-polymorphic across both (getNode/listChildren/etc. take
 *  just an id, dispatched by the org_/geo_ prefix from uid() — see architecture
 *  spec §6). `crossCutting` holds methods that read across multiple domains
 *  (search, relationshipAnalytics) and so can't be owned by one domain either.
 *  `customers` is a new domain (Phase 2 Task 6) with no in-memory precedent —
 *  it goes straight into MIGRATED below since it's Supabase-backed from creation. */
export type DomainKey =
  | 'hierarchy' | 'departments' | 'geography' | 'employees' | 'ownership'
  | 'salesPeople' | 'commercialMasters' | 'commercialSkus' | 'commercialBom'
  | 'commercialBoqs' | 'auditLogs' | 'crossCutting' | 'customers'

/** Every `Repository` method, classified into exactly one domain. TypeScript
 *  rejects this file if any method from `Repository` is missing or duplicated
 *  — the same discipline `in-memory/repository.ts`'s own MUTATOR_KEYS/READER_KEYS
 *  exhaustiveness check already applies to read/write classification. Adding a
 *  new Repository method without adding it here is a compile error. */
export const DOMAIN_OF: Record<keyof Repository, DomainKey> = {
  // hierarchy — id-polymorphic across departments and geo_nodes
  createNode: 'hierarchy', updateNode: 'hierarchy', setNodeStatus: 'hierarchy',
  deleteNode: 'hierarchy', moveNode: 'hierarchy', duplicateNode: 'hierarchy',
  reorderNode: 'hierarchy', importChildren: 'hierarchy', getNode: 'hierarchy',
  listChildren: 'hierarchy', breadcrumb: 'hierarchy', childCount: 'hierarchy',
  moveTargets: 'hierarchy',

  // departments — org-tree-specific reads
  listOrgRoots: 'departments', listDepartments: 'departments', listPostingNodes: 'departments',

  // geography — geo-tree-specific reads
  listStates: 'geography', getState: 'geography', geoRoot: 'geography', childCounts: 'geography',

  // employees
  importEmployees: 'employees', createEmployee: 'employees', updateEmployee: 'employees',
  setManager: 'employees', deleteEmployee: 'employees', mergeEmployees: 'employees',
  addTimelineEvent: 'employees', setTimelineEventAttended: 'employees', deleteTimelineEvent: 'employees',
  transferEmployee: 'employees', addCharge: 'employees', removeCharge: 'employees',
  listEmployeesUnder: 'employees', listEmployeesDirect: 'employees', listEmployeesByState: 'employees',
  listAllEmployees: 'employees', listEmployeeDepartments: 'employees', getEmployee: 'employees',
  directReports: 'employees', reportingChain: 'employees', listTimeline: 'employees',
  listAllTimelineEvents: 'employees', listTransfers: 'employees', listMergeAudit: 'employees',

  // ownership — opportunities, ownership assignments, follow-ups
  createOpportunity: 'ownership', updateOpportunity: 'ownership', deleteOpportunity: 'ownership',
  createFollowUp: 'ownership', setFollowUpStatus: 'ownership', deleteFollowUp: 'ownership',
  assignOwner: 'ownership', endOwnership: 'ownership', transferBookOfBusiness: 'ownership',
  listOpportunities: 'ownership', listOpportunitiesByDepartment: 'ownership', getOpportunity: 'ownership',
  listOpportunityStageChanges: 'ownership', listFollowUps: 'ownership', listOpenFollowUps: 'ownership',
  listOwnershipAssignments: 'ownership', listOwnershipFor: 'ownership', listOwnedBy: 'ownership',
  resolveOwner: 'ownership', resolveOwners: 'ownership',

  // salesPeople
  createSalesPerson: 'salesPeople', updateSalesPerson: 'salesPeople', setSalesPersonStatus: 'salesPeople',
  deleteSalesPerson: 'salesPeople', transferSalesPerson: 'salesPeople', listSalesPersons: 'salesPeople',
  getSalesPerson: 'salesPeople', listSalesPostings: 'salesPeople', currentPostings: 'salesPeople',

  // commercialMasters
  createMaster: 'commercialMasters', updateMaster: 'commercialMasters', setMasterActive: 'commercialMasters',
  deleteMaster: 'commercialMasters', setEditionFeatures: 'commercialMasters', listMaster: 'commercialMasters',
  getMaster: 'commercialMasters', listEditionFeatures: 'commercialMasters',
  // Classified here (not a real "master entity" mutation) so the DOMAIN_OF
  // exhaustiveness check passes. Deliberately NEVER added to SUPABASE_IMPL —
  // see Task 1 of the Phase 3 plan and the interface doc comment.
  recordCommercialAuditLogEntry: 'commercialMasters',

  // commercialSkus
  createSku: 'commercialSkus', updateSku: 'commercialSkus', deleteSku: 'commercialSkus',
  listSkus: 'commercialSkus', getSku: 'commercialSkus',

  // commercialBom
  createBomItem: 'commercialBom', updateBomItem: 'commercialBom', deleteBomItem: 'commercialBom',
  listBomItemsForSku: 'commercialBom', listAllBomItems: 'commercialBom',

  // commercialBoqs
  createBoq: 'commercialBoqs', addBoqLineItem: 'commercialBoqs', updateBoqLineItem: 'commercialBoqs',
  removeBoqLineItem: 'commercialBoqs', updateBoqStatus: 'commercialBoqs', reviseBoq: 'commercialBoqs',
  duplicateBoq: 'commercialBoqs', deleteBoq: 'commercialBoqs', listBoqs: 'commercialBoqs',
  getBoq: 'commercialBoqs', listBoqLineItems: 'commercialBoqs', listAllBoqLineItems: 'commercialBoqs',

  // auditLogs
  listAuditLogs: 'auditLogs',

  // crossCutting — reads that span more than one domain
  search: 'crossCutting', relatedRecords: 'crossCutting', relationshipAnalytics: 'crossCutting',

  // customers — new in Phase 2, no in-memory precedent
  listCustomers: 'customers', getCustomer: 'customers', createCustomer: 'customers',
  updateCustomer: 'customers', deleteCustomer: 'customers',
}

/** Domains with a working Supabase-backed implementation, selected in
 *  SUPABASE_IMPL below. Empty throughout Phase 1 — every method resolves to
 *  `inMemoryRepository`, so the app's behavior is unchanged. Phase 2+ adds one
 *  entry at a time, in the sequential order defined in the architecture spec §8. */
export const MIGRATED = new Set<DomainKey>([
  'departments', 'geography', 'hierarchy', 'employees', 'customers', 'salesPeople', 'ownership',
  'commercialMasters', 'commercialSkus', 'commercialBom',
])

/** Populated by each domain's Phase 2+ Supabase implementation — e.g.
 *  `SUPABASE_IMPL.listOrgRoots = departmentsSupabaseImpl.listOrgRoots`. Only
 *  methods whose domain is in `MIGRATED` are actually selected (see
 *  `buildRepository` below), so a partially-populated `SUPABASE_IMPL` during
 *  a domain's in-progress migration never accidentally activates early. */
const SUPABASE_IMPL: Partial<Repository> = {
  listOrgRoots, listDepartments, listPostingNodes,
  listStates, getState, geoRoot, childCounts,
  getNode, listChildren, breadcrumb, childCount, createNode, updateNode,
  setNodeStatus, deleteNode, moveNode, duplicateNode, reorderNode, importChildren, moveTargets,
  listEmployeesUnder, listEmployeesDirect, listEmployeesByState, listAllEmployees, listEmployeeDepartments,
  getEmployee, directReports, reportingChain, listTimeline, listAllTimelineEvents, listTransfers, listMergeAudit,
  createEmployee, updateEmployee, setManager, deleteEmployee, mergeEmployees, addTimelineEvent,
  setTimelineEventAttended, deleteTimelineEvent, transferEmployee, addCharge, removeCharge, importEmployees,
  listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer,
  createSalesPerson, updateSalesPerson, setSalesPersonStatus, deleteSalesPerson, transferSalesPerson,
  listSalesPersons, getSalesPerson, listSalesPostings, currentPostings,
  createOpportunity, updateOpportunity, deleteOpportunity, createFollowUp, setFollowUpStatus, deleteFollowUp,
  assignOwner, endOwnership, transferBookOfBusiness, listOpportunities, listOpportunitiesByDepartment,
  getOpportunity, listOpportunityStageChanges, listFollowUps, listOpenFollowUps, listOwnershipAssignments,
  listOwnershipFor, listOwnedBy, resolveOwner, resolveOwners,
  listMaster, getMaster, createMaster, updateMaster, setMasterActive, deleteMaster,
  listEditionFeatures, setEditionFeatures,
  listSkus, getSku, createSku, updateSku, deleteSku,
  listBomItemsForSku, listAllBomItems, createBomItem, updateBomItem, deleteBomItem,
}

/** A Proxy, not `{ ...inMemoryRepository }`: `InMemoryRepository`'s methods
 *  are regular class methods living on its prototype, not own instance
 *  properties, so an object spread silently drops every single one of them
 *  (confirmed — spreading produced an object with zero callable methods).
 *  Delegating through `Reflect.get` walks the prototype chain correctly,
 *  exactly like `in-memory/repository.ts`'s own mutator-wrapping Proxy does. */
function buildRepository(): Repository {
  return new Proxy(inMemoryRepository, {
    get(target, prop, receiver) {
      const key = prop as keyof Repository
      const domain = DOMAIN_OF[key]
      if (domain !== undefined && MIGRATED.has(domain) && key in SUPABASE_IMPL) {
        return (SUPABASE_IMPL as Record<string, unknown>)[key as string]
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as Repository
}

export const repository: Repository = buildRepository()

import type { Repository } from './in-memory/repository'
import { repository as inMemoryRepository } from './in-memory/repository'

/** One bucket per independently-migratable slice of the Repository interface.
 *  `hierarchy` is not `departments` or `geography`: it holds the handful of
 *  methods that are id-polymorphic across both (getNode/listChildren/etc. take
 *  just an id, dispatched by the org_/geo_ prefix from uid() — see architecture
 *  spec §6). `crossCutting` holds methods that read across multiple domains
 *  (search, relationshipAnalytics) and so can't be owned by one domain either.
 *  `customers` is intentionally absent: it owns zero existing Repository
 *  methods today (Customer is a new entity with no interface methods yet) —
 *  Phase 2 adds customer methods to Repository and to this map together. */
export type DomainKey =
  | 'hierarchy' | 'departments' | 'geography' | 'employees' | 'ownership'
  | 'salesPeople' | 'commercialMasters' | 'commercialSkus' | 'commercialBom'
  | 'commercialBoqs' | 'auditLogs' | 'crossCutting'

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
}

/** Domains with a working Supabase-backed implementation, selected in
 *  SUPABASE_IMPL below. Empty throughout Phase 1 — every method resolves to
 *  `inMemoryRepository`, so the app's behavior is unchanged. Phase 2+ adds one
 *  entry at a time, in the sequential order defined in the architecture spec §8. */
export const MIGRATED = new Set<DomainKey>([])

/** Populated by each domain's Phase 2+ Supabase implementation — e.g.
 *  `SUPABASE_IMPL.listOrgRoots = departmentsSupabaseImpl.listOrgRoots`. Only
 *  methods whose domain is in `MIGRATED` are actually selected (see
 *  `buildRepository` below), so a partially-populated `SUPABASE_IMPL` during
 *  a domain's in-progress migration never accidentally activates early. */
const SUPABASE_IMPL: Partial<Repository> = {}

function buildRepository(): Repository {
  const composed = { ...inMemoryRepository } as Repository
  for (const key of Object.keys(DOMAIN_OF) as (keyof Repository)[]) {
    const domain = DOMAIN_OF[key]
    if (MIGRATED.has(domain) && key in SUPABASE_IMPL) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (composed as any)[key] = SUPABASE_IMPL[key]
    }
  }
  return composed
}

export const repository: Repository = buildRepository()

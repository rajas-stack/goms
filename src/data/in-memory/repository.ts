import type {
  ActionQueueEntry, AttendeeRef, Bid, BidCorrigendum, BidCorrigendumChange, BidCustomField, BidCustomFieldValue,
  BidDocument, BidGridRow, BidMilestone, BidMilestoneWithBid, CustomFieldType, CustomValue,
  BidSavedView, Charge, Customer, Domain, DocumentCitation, Employee, FollowUp, HierNode, MergeAuditRecord,
  MergeFieldResolution, Opportunity, OpportunityStageChange, OwnershipAssignment, PreferredComm, ProtectedValue,
  RelationshipQuality, RelationshipStatus,
  SalesPerson, SalesPosting, SearchResult, Status, TimelineEvent, TimelineEventType, Transfer, VisitingCardItem,
} from '@/lib/types'
import { uid } from '@/lib/utils'
import { isoToday } from '@/lib/dates'
import { NODE_TYPE_MAP, POSTING_TYPES, childTypesOf, isValidChildType } from '@/lib/node-types'
import {
  MERGEABLE_FIELDS, type MergeableField,
  DEFAULT_STAGE_KEY, PIPELINE_STAGE_MAP,
  buildOwnerMap, effectiveOwner, OWNABLE_ENTITY_MAP,
  type OwnerResolution, type OwnershipContext,
  performSearch, performRelatedRecords, type SearchData, planPostingDatesEdit, type PostingDatesEdit,
  DEFAULT_BID_STAGE_KEY, formatBidCode, isAtOrAfterSubmitted, computeAttentionFlag, applyFilterRules,
  SYSTEM_BID_VIEWS, SYSTEM_BID_VIEW_KEYS, type SystemBidViewFilterRule,
  coerceCustomValue, normalizeOptions, slugifyFieldKey,
} from '@goms/domain'
export { MERGEABLE_FIELDS, type MergeableField }
import { coversDate } from '@/lib/intervals'
import { tierRank } from '../sales-tiers'
import { buildSeed, type GormsData } from '../seed'
import { clearSnapshot, loadSnapshot, scheduleSave } from '../persist'
import {
  addBoqLineItemLogic, createBoqLogic, createBomItemLogic, createMasterLogic, createSkuLogic,
  deleteBomItemLogic, deleteBoqLogic, deleteMasterLogic, deleteSkuLogic, duplicateBoqLogic, getBoqLogic, getMasterLogic, getSkuLogic,
  listAllBomItemsLogic, listAllBoqLineItemsLogic, listAuditLogsLogic, listBoqLineItemsLogic, listBoqsLogic,
  listBomItemsForSkuLogic, listEditionFeaturesLogic,
  listMasterLogic, listSkusLogic, removeBoqLineItemLogic, reorderBoqLineItemsLogic, reviseBoqLogic, setEditionFeaturesLogic,
  setMasterActiveLogic, updateBoqLineItemLogic, updateBoqLogic, updateBoqStatusLogic, updateBomItemLogic, updateMasterLogic,
  updateSkuLogic, writeAuditLogEntry,
} from '@/modules/commercial-calculator/repository-logic'
import type {
  BoqStatus, CommercialAuditLog, CommercialBoq, CommercialBoqLineItem, CommercialBomItem, CommercialSku,
  CreateBoqInput, CreateBoqLineItemInput, CreateBomItemInput, CreateMasterInput, CreateSkuInput, MasterEntityKey,
  MasterRowMap, ProductEditionFeature, UpdateBoqInput,
} from '@/modules/commercial-calculator/types'

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

/** Aggregate relationship metrics powering the analytics dashboard. */
export interface RelationshipAnalytics {
  total: number
  connected: number
  notConnected: number
  vacant: number
  transfers: number
  highPriority: number
  qualityDist: Record<RelationshipQuality, number>
  statusDist: Record<RelationshipStatus, number>
  recentInteractions: InteractionSummary[]
  /** Logged `meeting`/`inPerson` entries dated after today, soonest first. */
  upcomingMeetings: InteractionSummary[]
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
  company?: string
  address?: string
  website?: string
  orgNodeId: string
  managerId: string | null
  vacant?: boolean
  connected?: boolean
  relationshipStatus?: RelationshipStatus
  relationshipQuality?: RelationshipQuality
  relationshipType?: string
  introducedBy?: string
  importantContact?: boolean
  preferredComm?: PreferredComm[]
  lastInteractionAt?: string | null
  followUpDate?: string | null
  notes?: string
  charges?: Charge[]
  /** A card scanned during creation, if any — attached from the start rather
   *  than requiring a separate post-create upload step. */
  visitingCards?: VisitingCardItem[]
  metadata?: Record<string, string>
}

export interface CreateCustomerInput {
  name: string
  organization?: string
  address?: string
  gst?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  notes?: string
}

export interface AddTimelineInput {
  employeeId: string
  type: TimelineEventType
  title: string
  customLabel?: string
  date: string
  time?: string
  note?: string
  attendees?: AttendeeRef[]
  agenda?: string
  outcome?: string
  nextSteps?: string
}

export interface ImportChildRow {
  name: string
  /** Child type label (e.g. "Office", "Division") matched case-insensitively
   *  against the parent's valid child types — falls back to the parent's
   *  first child type (prior single-type-per-import behavior) when blank or
   *  unrecognized. */
  type?: string
}

export interface ImportEmployeeRow {
  name: string
  designation: string
  email?: string
  phone?: string
  connected?: boolean
}

export interface MergeEmployeesInput {
  /** The record that stays. */
  survivorId: string
  /** The record that's absorbed and deleted. */
  duplicateId: string
  /** Explicit picks for fields where both records had a different, non-empty
   *  value — anything left out here keeps the survivor's own value if it has
   *  one, else auto-fills from the duplicate. */
  resolutions: Partial<Pick<Employee, MergeableField>>
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

export interface CreateOpportunityInput {
  departmentId: string
  opportunityName: string
  gemTenderId?: string
  city?: string | null
  publishDate?: string
  submissionDate?: string
  vertical?: string
  component?: string[]
  quantity?: string
  currency?: string
  valueAmount?: string
  valueUnit?: string
  budgetKnown?: string
  emdAmount?: string
  emdUnit?: string
  salesPersonEmail?: string
  /** Defaults to `DEFAULT_STAGE_KEY`. */
  stageKey?: string
}

export interface CreateSalesPersonInput {
  name: string
  officialEmail: string
  personalEmail?: string
  mobile?: string
  altMobile?: string
  photoUrl?: string | null
  notes?: string
  /** Initial posting — a person is created WITH a posting, never without one;
   *  a posting-less person can't appear correctly in the org chart or reports. */
  designation: string
  tierKey: string
  managerId?: string | null
}

export interface TransferSalesPersonInput {
  salesPersonId: string
  designation: string
  tierKey: string
  managerId?: string | null
  office?: string
  effectiveDate: string
  reason?: string
}

export interface TransferBookOfBusinessInput {
  fromSalesPersonId: string
  toSalesPersonId: string
  effectiveDate: string
  note?: string
}

export interface AssignOwnerInput {
  entityType: string
  entityId: string
  salesPersonId: string
  /** 'owner' replaces the current open owner; 'delegate' runs in parallel and
   *  MUST carry an endDate (spec §6.4). */
  role?: string
  startDate: string
  endDate?: string | null
  reason?: OwnershipAssignment['reason']
  note?: string
}

export interface CreateFollowUpInput {
  entityType: string
  entityId: string
  dueDate: string
  note?: string
  /** → `SalesPerson.id`. Always null until the Roster phase. */
  assigneeId?: string | null
}

/** All persistence flows through this interface. The in-memory implementation
 *  below can be replaced by a Supabase-backed one with no UI changes. */
export interface Repository {
  listStates(): Promise<StateSummary[]>
  getState(code: number): Promise<HierNode | undefined>
  getNode(id: string): Promise<HierNode | undefined>
  listChildren(parentId: string): Promise<HierNode[]>
  listOrgRoots(stateCode: number): Promise<HierNode[]>
  /** Every active department node across every state — powers the export,
   *  which is cross-state (unlike `listOrgRoots`, which is per-state). */
  listDepartments(): Promise<HierNode[]>
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
  getEmployee(id: string): Promise<Employee | null>
  directReports(employeeId: string): Promise<Employee[]>
  reportingChain(employeeId: string): Promise<Employee[]>
  createEmployee(input: CreateEmployeeInput): Promise<Employee>
  updateEmployee(id: string, patch: Partial<Employee>): Promise<Employee>
  setManager(employeeId: string, managerId: string | null): Promise<void>
  deleteEmployee(id: string): Promise<void>
  /** Merges `duplicateId` into `survivorId`: reassigns every timeline event,
   *  transfer, direct report, and department headship pointing at the
   *  duplicate over to the survivor, combines list fields, applies the
   *  caller's field resolutions, deletes the duplicate, and appends one
   *  `MergeAuditRecord`. Never automatic — always an explicit user action. */
  mergeEmployees(input: MergeEmployeesInput): Promise<{ survivor: Employee; audit: MergeAuditRecord }>
  /** Every past merge, newest first — the only place a merged-away record's
   *  identity and what happened to it survive for later review. */
  listMergeAudit(): Promise<MergeAuditRecord[]>

  listTimeline(employeeId: string): Promise<TimelineEvent[]>
  /** Every timeline event across every employee, newest first — powers the
   *  cross-employee Meetings & Events screen. Optionally narrowed to a set of
   *  event types. */
  listAllTimelineEvents(filter?: { types?: TimelineEventType[] }): Promise<TimelineEvent[]>
  addTimelineEvent(input: AddTimelineInput): Promise<TimelineEvent>
  /** Item 14: edits an existing entry's fields in place (same id, no new
   *  row) — date/time/title/attendees/agenda/note/outcome/nextSteps. */
  updateTimelineEvent(id: string, patch: Partial<TimelineEvent>): Promise<TimelineEvent>
  /** Marks (or un-marks) attendance on an existing entry — the only field
   *  editable after logging. */
  setTimelineEventAttended(id: string, attended: boolean | undefined): Promise<void>
  deleteTimelineEvent(id: string): Promise<void>

  listTransfers(employeeId: string): Promise<Transfer[]>
  transferEmployee(input: TransferInput): Promise<Transfer>

  /** Every opportunity across every department, newest first. */
  listOpportunities(): Promise<Opportunity[]>
  listOpportunitiesByDepartment(departmentId: string): Promise<Opportunity[]>
  getOpportunity(id: string): Promise<Opportunity | null>
  /** Append-only stage history for one opportunity, oldest first. */
  listOpportunityStageChanges(opportunityId: string): Promise<OpportunityStageChange[]>
  createOpportunity(input: CreateOpportunityInput): Promise<Opportunity>
  updateOpportunity(id: string, patch: Partial<Opportunity>): Promise<Opportunity>
  deleteOpportunity(id: string): Promise<void>

  /** The AMNEX sales roster, name-sorted. Includes every status — the UI
   *  filters, so a resigned person stays reachable from their history. */
  listSalesPersons(): Promise<SalesPerson[]>
  getSalesPerson(id: string): Promise<SalesPerson | null>
  /** Postings for one person, most recent first. */
  listSalesPostings(salesPersonId: string): Promise<SalesPosting[]>
  /** Each person's currently-open posting, keyed by person id — one pass, so a
   *  roster list can show designation and tier without a query per row. */
  currentPostings(): Promise<Record<string, SalesPosting>>

  /** Every ownership/delegation row, newest start first. */
  listOwnershipAssignments(): Promise<OwnershipAssignment[]>
  /** Rows touching one entity, including closed ones — this is its history. */
  listOwnershipFor(entityType: string, entityId: string): Promise<OwnershipAssignment[]>
  /** Everything one person owns or is delegated, open rows only at `asOf`. */
  listOwnedBy(salesPersonId: string, asOf: string): Promise<OwnershipAssignment[]>
  createSalesPerson(input: CreateSalesPersonInput): Promise<SalesPerson>
  updateSalesPerson(id: string, patch: Partial<SalesPerson>): Promise<SalesPerson>
  setSalesPersonStatus(id: string, status: SalesPerson['status']): Promise<void>
  deleteSalesPerson(id: string): Promise<void>
  transferSalesPerson(input: TransferSalesPersonInput): Promise<SalesPosting>
  /** In-place manager/GM-override change on the currently-open posting —
   *  distinct from `transferSalesPerson`, which closes the current posting
   *  and opens a new one. Does not touch designation/tier/start-end
   *  dates/changeType. `patch` only updates the keys it includes — omit a
   *  key to leave it untouched (e.g. changing just `gmOverrideId` without
   *  touching `managerId`). */
  updatePostingManager(personId: string, patch: { managerId?: string | null; gmOverrideId?: string | null }): Promise<SalesPosting>
  /** Edits a posting's Effective from / Effective to. `lastDayHeld` is the
   *  last day actually held (inclusive; stored as an exclusive end); `null`
   *  means Present. Setting one on the open posting ENDS it. Boundary rules —
   *  contiguity, no overlap — are `planPostingDatesEdit`'s (shared with the API). */
  updatePostingDates(postingId: string, edit: PostingDatesEdit): Promise<SalesPosting>
  /** Who effectively owns this entity — direct, or inherited from an ancestor. */
  resolveOwner(entityType: string, entityId: string, asOf: string): Promise<OwnerResolution | null>
  /** Batch form. Use this for lists: the per-entity call re-walks the ancestor
   *  chain for every row, which §13 names the design's largest perf risk. */
  resolveOwners(entityType: string, entityIds: string[], asOf: string): Promise<Record<string, OwnerResolution>>
  /** Assigns an owner, closing any existing open owner on the same entity as of
   *  `startDate`. Rejects rather than warns on a bad write — see spec §8. */
  assignOwner(input: AssignOwnerInput): Promise<OwnershipAssignment>
  /** Closes an open assignment as of `endDate` (exclusive). */
  endOwnership(id: string, endDate: string): Promise<void>
  /** Reassigns every entity `fromSalesPersonId` currently owns (departments,
   *  contacts, opportunities) to `toSalesPersonId` in one operation — the
   *  handoff needed when someone goes on indefinite leave or resigns, so
   *  their book of business doesn't sit orphaned. */
  transferBookOfBusiness(input: TransferBookOfBusinessInput): Promise<OwnershipAssignment[]>

  /** Follow-ups against one entity, soonest due first. */
  listFollowUps(entityType: string, entityId: string): Promise<FollowUp[]>
  /** Every open follow-up across every entity, soonest due first. */
  listOpenFollowUps(): Promise<FollowUp[]>
  createFollowUp(input: CreateFollowUpInput): Promise<FollowUp>
  setFollowUpStatus(id: string, status: FollowUp['status']): Promise<void>
  deleteFollowUp(id: string): Promise<void>

  addCharge(employeeId: string, charge: Omit<Charge, 'id'>): Promise<Charge>
  removeCharge(employeeId: string, chargeId: string): Promise<void>

  search(query: string, stateCode?: number): Promise<SearchResult[]>
  relatedRecords(result: SearchResult): Promise<SearchResult[]>
  importChildren(parentId: string, rows: ImportChildRow[]): Promise<number>
  importEmployees(orgNodeId: string, rows: ImportEmployeeRow[]): Promise<number>
  moveTargets(nodeId: string): Promise<HierNode[]>
  reorderNode(id: string, beforeId: string | null): Promise<void>
  relationshipAnalytics(): Promise<RelationshipAnalytics>

  // --- Customers (new in Phase 2, spec §6) -----------------------------------
  listCustomers(): Promise<Customer[]>
  getCustomer(id: string): Promise<Customer | null>
  createCustomer(input: CreateCustomerInput): Promise<Customer>
  updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer>
  deleteCustomer(id: string): Promise<void>

  // --- Commercial Calculator: generic master CRUD (thin delegation) ------
  // Real logic lives in src/modules/commercial-calculator/repository-logic.ts.
  // Spec §4.2.
  listMaster<K extends MasterEntityKey>(key: K): Promise<MasterRowMap[K][]>
  getMaster<K extends MasterEntityKey>(key: K, id: string): Promise<MasterRowMap[K] | null>
  createMaster<K extends MasterEntityKey>(key: K, input: CreateMasterInput<K>): Promise<MasterRowMap[K]>
  /** `changeReason` is required when `patch` changes a `features` row's
   *  `status` — throws otherwise (spec §15). */
  updateMaster<K extends MasterEntityKey>(key: K, id: string, patch: Partial<MasterRowMap[K]>, changeReason?: string): Promise<MasterRowMap[K]>
  setMasterActive(key: MasterEntityKey, id: string, active: boolean): Promise<void>
  /** Throws if any other master row still references this one — e.g.
   *  deleting a Vertical that still has Products. */
  deleteMaster(key: MasterEntityKey, id: string): Promise<void>

  // --- Commercial Calculator: Product Edition ↔ Feature mapping (spec §6.2) --
  listEditionFeatures(editionId: string): Promise<ProductEditionFeature[]>
  setEditionFeatures(editionId: string, rows: { featureId: string; mandatory: boolean }[]): Promise<void>

  // --- Commercial Calculator: SKU Catalog (thin delegation, spec §6.3/§7/§14) -
  listSkus(): Promise<CommercialSku[]>
  getSku(id: string): Promise<CommercialSku | null>
  createSku(input: CreateSkuInput): Promise<CommercialSku>
  /** `changeReason` is required when `patch` touches lifecycle status, cost,
   *  or pricing fields — throws otherwise (spec §15). */
  updateSku(id: string, patch: Partial<CommercialSku>, changeReason?: string): Promise<CommercialSku>
  /** Throws if any BOQ line item or BOM item still references this SKU (PCS-038). */
  deleteSku(id: string): Promise<void>

  // --- Commercial Calculator: Commercial BOM (spec §6.4/§14) -----------------
  listBomItemsForSku(parentSkuId: string): Promise<CommercialBomItem[]>
  /** Every BOM item across every parent SKU — read-only aggregate for the SKU
   *  Catalog's "Usage Count" column. */
  listAllBomItems(): Promise<CommercialBomItem[]>
  createBomItem(input: CreateBomItemInput): Promise<CommercialBomItem>
  updateBomItem(id: string, patch: Partial<CommercialBomItem>): Promise<CommercialBomItem>
  deleteBomItem(id: string): Promise<void>

  // --- Commercial Calculator: BOQ (spec §6.5/§9/§10/§12/§13) -----------------
  listBoqs(): Promise<CommercialBoq[]>
  getBoq(id: string): Promise<CommercialBoq | null>
  listBoqLineItems(boqId: string): Promise<CommercialBoqLineItem[]>
  /** Every BOQ line item across every BOQ — read-only aggregate for the SKU
   *  Catalog's "BOQ Count" column. */
  listAllBoqLineItems(): Promise<CommercialBoqLineItem[]>
  createBoq(input: CreateBoqInput): Promise<CommercialBoq>
  /** BOQ-level metadata patch — throws unless `status === 'draft'` (BOQ
   *  editable-workspace overhaul spec §3). */
  updateBoq(id: string, patch: UpdateBoqInput): Promise<CommercialBoq>
  addBoqLineItem(boqId: string, input: CreateBoqLineItemInput): Promise<CommercialBoqLineItem>
  updateBoqLineItem(
    id: string,
    patch: Partial<Pick<CommercialBoqLineItem,
      'quantity' | 'unitPrice' | 'discountPct' | 'approverId' | 'approvalDate' | 'approvalRemarks' | 'approvalStatus'
      | 'pricingLevels' | 'activePricingLevel'
    >>,
  ): Promise<CommercialBoqLineItem>
  removeBoqLineItem(id: string): Promise<void>
  /** Reorders a draft BOQ's line items — `orderedIds` must be exactly this
   *  BOQ's current line item ids, each exactly once, in the desired order.
   *  Throws unless `status === 'draft'` (BOQ workbench spec §6). */
  reorderBoqLineItems(boqId: string, orderedIds: string[]): Promise<void>
  /** Throws on an invalid lifecycle transition (spec §10's `BOQ_TRANSITIONS`). */
  updateBoqStatus(id: string, nextStatus: BoqStatus, changeReason: string): Promise<CommercialBoq>
  /** Creates a new BOQ row carrying the same `boqNumber` forward, with
   *  `boqVersion` incremented and its line items copied (spec §9/§13). */
  reviseBoq(id: string): Promise<CommercialBoq>
  /** Creates an independent new BOQ — fresh `boqNumber`, `status: 'draft'`,
   *  `boqVersion: 1`, no `parentBoqId` — copying this BOQ's fields and line
   *  items as a starting point. Distinct from `reviseBoq`, which keeps the
   *  same `boqNumber` and links back via `parentBoqId`: a duplicate is a new,
   *  unrelated proposal. */
  duplicateBoq(id: string): Promise<CommercialBoq>
  /** Hard-deletes a BOQ and its line items. Throws unless the BOQ is
   *  `draft`/`cancelled`/`rejected`/`archived` — anything still active in
   *  the pipeline must be cancelled first via `updateBoqStatus`. */
  deleteBoq(id: string): Promise<void>

  // --- Commercial Calculator: Audit Log (spec §6.6/§15) ----------------------
  listAuditLogs(filter?: { entityType?: string; entityId?: string }): Promise<CommercialAuditLog[]>

  // --- Bid Tracker ---
  listBidsForGrid(filterRules?: SystemBidViewFilterRule[]): Promise<BidGridRow[]>
  getBid(id: string): Promise<Bid | null>
  getBidForOpportunity(opportunityId: string): Promise<Bid | null>
  createBid(opportunityId: string): Promise<Bid>
  updateBid(id: string, patch: Partial<Pick<Bid, 'stageKey' | 'decision' | 'tenderLink'>>): Promise<Bid>
  archiveBid(id: string): Promise<Bid>
  markBidVerified(id: string): Promise<Bid>
  unarchiveBid(id: string): Promise<Bid>
  deleteBid(id: string): Promise<void>
  listBidActionQueue(): Promise<ActionQueueEntry[]>

  listBidMilestones(bidId: string): Promise<BidMilestone[]>
  listAllBidMilestones(): Promise<BidMilestoneWithBid[]>
  createBidMilestone(input: {
    bidId: string; milestoneType: string; key: string; label: string
    dueAt?: string | null; venue?: string; notes?: string
  }): Promise<BidMilestone>
  updateBidMilestone(id: string, patch: Partial<Pick<BidMilestone, 'label' | 'dueAt' | 'venue' | 'notes' | 'status'>>): Promise<BidMilestone>
  deleteBidMilestone(id: string): Promise<void>

  listBidCorrigenda(bidId: string): Promise<BidCorrigendum[]>
  createBidCorrigendum(input: {
    bidId: string; corrigendumNumber: number; sourceDocumentId?: string
    changes: { fieldKey: string; currentValue: string; proposedValue: string }[]
  }): Promise<BidCorrigendum>
  reviewCorrigendumChange(input: { changeId: string; decision: 'accepted' | 'rejected'; reason?: string }): Promise<BidCorrigendumChange>

  listProtectedValues(entityType: string, entityId: string): Promise<ProtectedValue[]>
  freezeValue(entityType: string, entityId: string, fieldKey: string): Promise<void>
  unfreezeValue(entityType: string, entityId: string, fieldKey: string, reason: string): Promise<void>

  requestDocumentUploadUrl(input: {
    entityType: string; entityId: string; filename: string; contentType: string; sizeBytes: number; version?: string
  }): Promise<{ uploadId: string; uploadUrl: string }>
  confirmDocumentUpload(uploadId: string): Promise<BidDocument>
  listDocuments(entityType: string, entityId: string): Promise<BidDocument[]>
  deleteDocument(id: string): Promise<void>
  getDocumentDownloadUrl(id: string): Promise<string>
  listDocumentCitations(documentId: string): Promise<DocumentCitation[]>
  deleteDocumentCitation(id: string): Promise<void>
  createDocumentCitation(input: { documentId: string; pageLabel: string; quoteText?: string; fieldRef?: string }): Promise<DocumentCitation>

  listBidSavedViews(): Promise<BidSavedView[]>
  createBidSavedView(input: {
    name: string; scope: 'personal' | 'global'
    filterRules?: SystemBidViewFilterRule[]; sort?: unknown[]; visibleColumns?: string[]
  }): Promise<BidSavedView>
  updateBidSavedView(id: string, patch: Partial<Pick<BidSavedView, 'name' | 'filterRules' | 'sort' | 'visibleColumns'>>): Promise<BidSavedView>
  deleteBidSavedView(id: string): Promise<void>

  // --- Bid Tracker: custom columns (spec §8.1) ---
  listBidCustomFields(includeArchived?: boolean): Promise<BidCustomField[]>
  createBidCustomField(input: { name: string; dataType: CustomFieldType; options?: string[] }): Promise<BidCustomField>
  /** `key` and `dataType` are deliberately not patchable. */
  updateBidCustomField(id: string, patch: { name?: string; options?: string[] }): Promise<BidCustomField>
  /** `ids` must be exactly the current active column ids, each once. */
  reorderBidCustomFields(ids: string[]): Promise<BidCustomField[]>
  archiveBidCustomField(id: string): Promise<BidCustomField>
  unarchiveBidCustomField(id: string): Promise<BidCustomField>
  /** Throws while any value row exists — archive instead. */
  deleteBidCustomField(id: string): Promise<void>
  /** `null`/blank clears (removes the value row). */
  setBidCustomValue(
    bidId: string, fieldId: string, value: string | number | boolean | null,
  ): Promise<{ bidId: string; fieldId: string; key: string; value: CustomValue }>
  listBidCustomValues(bidId: string): Promise<Record<string, CustomValue>>
}

// Re-exported (not redefined) so existing `@/data/repository` import sites
// keep working while the implementation lives in the date module.
export { isoToday } from '@/lib/dates'

/** Local-dev-only bid-code sequence — no cross-session durability guarantee
 *  beyond what IndexedDB already gives the rest of this file (spec §6). */
let inMemoryBidSeq = 1

/** Upload slots handed out by `requestDocumentUploadUrl`, awaiting confirm. */
const pendingBidUploads = new Map<string, {
  entityType: string; entityId: string; filename: string; contentType: string; sizeBytes: number; version?: string
}>()

/** Parses opportunities.submissionDate the same way the backend's
 *  `bids.create` does (spec §4.5) — null for anything that doesn't parse. */
function parseSubmissionDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

class InMemoryRepository implements Repository {
  private data: GormsData = buildSeed()

  constructor() {
    // Collapse any duplicate same-name branches under the same parent.
    this.dedupeBranches()
  }

  /** Replaces the whole store — used to restore the locally persisted snapshot
   *  at startup, and to reset back to seed data. Not part of `Repository`: it's
   *  an implementation detail of the in-memory store, and a server-backed
   *  implementation would have no use for it. */
  hydrate(data: GormsData) {
    // Defensive against a snapshot that predates these collections but is
    // already stamped at the current SCHEMA_VERSION (so migrateSnapshot runs
    // no steps for it) — without this, every opportunity/followUp method
    // throws on `undefined.slice()`/`.push()` the first time it's called.
    this.data = {
      ...data,
      opportunities: data.opportunities ?? [],
      opportunityStageChanges: data.opportunityStageChanges ?? [],
      followUps: data.followUps ?? [],
      salesPersons: data.salesPersons ?? [],
      salesPostings: data.salesPostings ?? [],
      ownershipAssignments: data.ownershipAssignments ?? [],
      bids: data.bids ?? [],
      bidMilestones: data.bidMilestones ?? [],
      bidCorrigenda: data.bidCorrigenda ?? [],
      bidCorrigendumChanges: data.bidCorrigendumChanges ?? [],
      protectedValues: data.protectedValues ?? [],
      bidDocuments: data.bidDocuments ?? [],
      documentCitations: data.documentCitations ?? [],
      bidSavedViews: data.bidSavedViews ?? [],
      bidCustomFields: data.bidCustomFields ?? [],
      bidCustomFieldValues: data.bidCustomFieldValues ?? [],
    }
    // `mergeAudit` postdates some locally persisted snapshots (the static
    // type says it's always there, but a snapshot saved before this field
    // existed won't actually have it) — default it rather than let every
    // push/read on it throw for those users.
    if (!Array.isArray(this.data.mergeAudit)) this.data.mergeAudit = []
    // A snapshot written by an older build can still carry duplicates that
    // today's seed no longer produces, so re-run the same cleanup the seed gets.
    this.dedupeBranches()
  }

  /** The live store, for persisting. Returned by reference (not cloned): the
   *  caller hands it straight to IndexedDB, which structured-clones it during
   *  the write anyway. */
  snapshot(): GormsData {
    return this.data
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
            e.status === 'active' && !e.vacant && orgUnder.some((n) => n.id === e.orgNodeId),
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
      .filter((n) => n.domain === 'org' && n.typeKey === 'department' && n.parentId === null && n.stateCode === stateCode && n.status === 'active')
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async listDepartments() {
    return this.data.nodes
      .filter((n) => n.domain === 'org' && n.typeKey === 'department' && n.status === 'active')
      .sort((a, b) => (a.stateCode ?? 0) - (b.stateCode ?? 0) || a.name.localeCompare(b.name))
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
    if (input.parentId) {
      const parent = this.data.nodes.find((n) => n.id === input.parentId)
      if (parent && !isValidChildType(parent.typeKey, input.typeKey)) {
        throw new Error(`A ${NODE_TYPE_MAP[input.typeKey]?.label ?? input.typeKey} cannot be created under a ${NODE_TYPE_MAP[parent.typeKey]?.label ?? parent.typeKey}`)
      }
    }
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
    // Opportunities used to live inside the node's own metadata, so they died
    // with it automatically. Now they're a separate collection keyed by
    // departmentId, so a node delete has to cascade to them explicitly —
    // otherwise a deleted department's opportunities (and their stage
    // history) would live on forever, unreachable from the tree.
    const deletedOppIds = new Set(
      this.data.opportunities.filter((o) => ids.has(o.departmentId)).map((o) => o.id),
    )
    this.data.opportunities = this.data.opportunities.filter((o) => !ids.has(o.departmentId))
    this.data.opportunityStageChanges = this.data.opportunityStageChanges
      .filter((c) => !deletedOppIds.has(c.opportunityId))
  }

  async moveNode(id: string, newParentId: string | null) {
    if (newParentId) {
      if (this.subtreeIds(id).includes(newParentId)) {
        throw new Error('Cannot move a node into its own subtree')
      }
      const node = this.data.nodes.find((n) => n.id === id)
      const newParent = this.data.nodes.find((n) => n.id === newParentId)
      if (node && newParent && !isValidChildType(newParent.typeKey, node.typeKey)) {
        throw new Error(`A ${NODE_TYPE_MAP[node.typeKey]?.label ?? node.typeKey} cannot be moved under a ${NODE_TYPE_MAP[newParent.typeKey]?.label ?? newParent.typeKey}`)
      }
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
    // react-query's queryFn must never resolve to undefined (see useEmployee
    // in api.ts) — a removed employee's id can still be in flight in a
    // stale/invalidated query for a moment after deletion, so this must
    // resolve to null, not undefined, once the record is gone.
    return this.data.employees.find((e) => e.id === id) ?? null
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
      company: input.company ?? '',
      address: input.address ?? '',
      website: input.website ?? '',
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
      preferredComm: input.preferredComm ?? [],
      lastInteractionAt: input.lastInteractionAt ?? null,
      followUpDate: input.followUpDate ?? null,
      notes: input.notes ?? '',
      charges: input.charges ?? [],
      visitingCards: input.visitingCards ?? [],
      metadata: input.metadata ?? {},
      status: 'active',
    }
    this.data.employees.push(emp)
    if (!vacant) {
      this.data.timeline.push({
        id: uid('evt'), employeeId: emp.id, type: 'joined',
        title: 'Contact created', date: isoToday(),
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
    // Looked up BEFORE the employee is removed from the array below — the
    // previous version looked this up afterward, so `removed` was always
    // undefined and every direct report's managerId was unconditionally set
    // to null instead of falling back to the removed person's own manager,
    // contradicting this function's own contract (matches
    // apps/api/src/routers/employees.ts's `delete`, which reads manager_id
    // before deleting for exactly this reason).
    const removed = this.data.employees.find((e) => e.id === id)
    this.data.employees = this.data.employees.filter((e) => e.id !== id)
    this.data.timeline = this.data.timeline.filter((t) => t.employeeId !== id)
    this.data.transfers = this.data.transfers.filter((t) => t.employeeId !== id)
    this.data.followUps = this.data.followUps.filter((f) => !(f.entityType === 'contact' && f.entityId === id))
    // Orphaned reports fall back to the removed person's manager.
    for (const e of this.data.employees) {
      if (e.managerId === id) e.managerId = removed?.managerId ?? null
    }
    // Clears a dangling deptHead pointer if the deleted employee headed a
    // department — mergeEmployees (below) already does the equivalent
    // reassignment for its own case; a plain delete has no replacement
    // employee to reassign to, so the key is removed outright.
    for (const n of this.data.nodes) {
      if (n.metadata.deptHead === id) {
        const { deptHead: _deptHead, ...rest } = n.metadata
        n.metadata = rest
      }
    }
  }

  async mergeEmployees(input: MergeEmployeesInput) {
    const survivor = this.data.employees.find((e) => e.id === input.survivorId)
    const duplicate = this.data.employees.find((e) => e.id === input.duplicateId)
    if (!survivor || !duplicate) throw new Error('Both records must exist to merge')
    if (survivor.id === duplicate.id) throw new Error('Cannot merge a record with itself')

    // Scalar fields: an explicit resolution wins outright; otherwise an empty
    // survivor field is auto-filled from the duplicate. A field is only
    // logged below when the merge actually changed something on the
    // survivor — an untouched field (both sides agreed, or the survivor
    // already had the only non-empty value) isn't merge activity.
    const fieldResolutions: MergeFieldResolution[] = []
    const patch: Record<string, unknown> = {}
    for (const field of MERGEABLE_FIELDS) {
      const resolved = input.resolutions[field]
      if (resolved !== undefined) {
        if (resolved !== survivor[field]) {
          patch[field] = resolved
          fieldResolutions.push({ field, kept: resolved === duplicate[field] ? 'duplicate' : 'survivor', value: String(resolved) })
        }
      } else if (!survivor[field] && duplicate[field]) {
        patch[field] = duplicate[field]
        fieldResolutions.push({ field, kept: 'duplicate', value: String(duplicate[field]) })
      }
    }
    Object.assign(survivor, patch)

    // List/derived fields: combined rather than replaced — a merge should
    // never quietly drop relationship signal either side already had.
    survivor.preferredComm = [...new Set([...survivor.preferredComm, ...duplicate.preferredComm])] as PreferredComm[]
    const chargesMoved = duplicate.charges.length
    survivor.charges = [...survivor.charges, ...duplicate.charges]
    const visitingCardsMoved = duplicate.visitingCards.length
    survivor.visitingCards = [...survivor.visitingCards, ...duplicate.visitingCards]
    if (duplicate.lastInteractionAt && (!survivor.lastInteractionAt || duplicate.lastInteractionAt > survivor.lastInteractionAt)) {
      survivor.lastInteractionAt = duplicate.lastInteractionAt
    }
    if (duplicate.followUpDate && (!survivor.followUpDate || duplicate.followUpDate < survivor.followUpDate)) {
      survivor.followUpDate = duplicate.followUpDate
    }
    survivor.importantContact = survivor.importantContact || duplicate.importantContact
    survivor.connected = survivor.connected || duplicate.connected

    // Reassign every other record that pointed at the duplicate.
    const timelineMoved = this.data.timeline.filter((t) => t.employeeId === duplicate.id).length
    for (const t of this.data.timeline) if (t.employeeId === duplicate.id) t.employeeId = survivor.id

    const transfersMoved = this.data.transfers.filter((t) => t.employeeId === duplicate.id).length
    for (const t of this.data.transfers) if (t.employeeId === duplicate.id) t.employeeId = survivor.id

    let directReportsMoved = 0
    for (const e of this.data.employees) {
      if (e.id === survivor.id || e.id === duplicate.id) continue
      if (e.managerId === duplicate.id) { e.managerId = survivor.id; directReportsMoved += 1 }
    }
    // Either record may have reported to the other — that line no longer
    // makes sense once they're the same record, so it collapses/clears
    // rather than leaving a self-report or a dangling id.
    if (survivor.managerId === duplicate.id) survivor.managerId = duplicate.managerId
    if (survivor.managerId === survivor.id) survivor.managerId = null

    let departmentHeadshipsMoved = 0
    for (const n of this.data.nodes) {
      if (n.metadata.deptHead === duplicate.id) {
        n.metadata = { ...n.metadata, deptHead: survivor.id }
        departmentHeadshipsMoved += 1
      }
    }

    // Anyone manually flagged (metadata.duplicateOf) as a duplicate of the
    // record being removed now points at the survivor instead — except the
    // survivor itself, where that flag is simply resolved (it no longer
    // means anything once the two are the same record).
    for (const e of this.data.employees) {
      if (e.metadata.duplicateOf !== duplicate.id) continue
      const { duplicateOf: _drop, ...rest } = e.metadata
      e.metadata = e.id === survivor.id ? rest : { ...rest, duplicateOf: survivor.id }
    }

    this.data.employees = this.data.employees.filter((e) => e.id !== duplicate.id)

    const audit: MergeAuditRecord = {
      id: uid('merge'),
      survivorId: survivor.id,
      survivorName: survivor.name,
      duplicateId: duplicate.id,
      duplicateName: duplicate.name,
      mergedAt: new Date().toISOString(),
      fieldResolutions,
      transferred: {
        timelineEvents: timelineMoved,
        transfers: transfersMoved,
        directReports: directReportsMoved,
        departmentHeadships: departmentHeadshipsMoved,
        visitingCards: visitingCardsMoved,
        charges: chargesMoved,
      },
    }
    this.data.mergeAudit.push(audit)
    this.data.timeline.push({
      id: uid('evt'), employeeId: survivor.id, type: 'custom',
      customLabel: 'Merged duplicate',
      title: `Merged duplicate contact "${duplicate.name || duplicate.designation}" into this record`,
      date: isoToday(), note: '', source: 'system',
    })

    return { survivor, audit }
  }

  async listMergeAudit() {
    return this.data.mergeAudit.slice().sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
  }

  async listTimeline(employeeId: string) {
    return this.data.timeline
      .filter((t) => t.employeeId === employeeId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  }

  async listAllTimelineEvents(filter?: { types?: TimelineEventType[] }) {
    const types = filter?.types
    let events = this.data.timeline
    if (types && types.length > 0) {
      const wanted = new Set(types)
      events = events.filter((t) => wanted.has(t.type))
    }
    return events.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  }

  async addTimelineEvent(input: AddTimelineInput) {
    const evt: TimelineEvent = {
      id: uid('evt'), employeeId: input.employeeId, type: input.type,
      title: input.title, customLabel: input.type === 'custom' ? input.customLabel?.trim() || undefined : undefined,
      date: input.date, time: input.time || undefined,
      note: input.note ?? '', source: 'manual', attendees: input.attendees,
      agenda: input.agenda || undefined, outcome: input.outcome || undefined, nextSteps: input.nextSteps || undefined,
    }
    this.data.timeline.push(evt)
    return evt
  }

  async updateTimelineEvent(id: string, patch: Partial<TimelineEvent>) {
    const evt = this.data.timeline.find((t) => t.id === id)!
    Object.assign(evt, patch)
    return evt
  }

  async setTimelineEventAttended(id: string, attended: boolean | undefined) {
    const evt = this.data.timeline.find((t) => t.id === id)
    if (evt) evt.attended = attended
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

  async listOpportunities() {
    return this.data.opportunities
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.opportunityName.localeCompare(b.opportunityName))
  }

  async listOpportunitiesByDepartment(departmentId: string) {
    return this.data.opportunities
      .filter((o) => o.departmentId === departmentId)
      .sort((a, b) => a.opportunityName.localeCompare(b.opportunityName))
  }

  async getOpportunity(id: string) {
    // null, not undefined — react-query rejects an undefined queryFn result,
    // and a deleted id can still be in flight in a stale query.
    return this.data.opportunities.find((o) => o.id === id) ?? null
  }

  async listOpportunityStageChanges(opportunityId: string) {
    return this.data.opportunityStageChanges
      .filter((c) => c.opportunityId === opportunityId)
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.id.localeCompare(b.id))
  }

  async createOpportunity(input: CreateOpportunityInput) {
    const dept = this.data.nodes.find((n) => n.id === input.departmentId)
    const stageKey = input.stageKey ?? DEFAULT_STAGE_KEY
    const opp: Opportunity = {
      id: uid('opp'),
      departmentId: input.departmentId,
      stateCode: dept?.stateCode ?? null,
      stageKey,
      closedOn: PIPELINE_STAGE_MAP[stageKey]?.isClosed ? isoToday() : null,
      opportunityName: input.opportunityName,
      gemTenderId: input.gemTenderId ?? '',
      city: input.city ?? null,
      publishDate: input.publishDate ?? '',
      submissionDate: input.submissionDate ?? '',
      vertical: input.vertical ?? '',
      component: input.component ?? [],
      quantity: input.quantity ?? '',
      currency: input.currency ?? 'INR',
      valueAmount: input.valueAmount ?? '',
      valueUnit: input.valueUnit ?? 'lakh',
      budgetKnown: input.budgetKnown ?? '',
      emdAmount: input.emdAmount ?? '',
      emdUnit: input.emdUnit ?? 'lakh',
      salesPersonEmail: input.salesPersonEmail ?? '',
      createdAt: isoToday(),
      createdBy: null,
    }
    this.data.opportunities.push(opp)
    // The opening row of the stage log. Migrated opportunities deliberately
    // get none (their real history is unknown — see migrations.ts), so a
    // missing opening row means "pre-existing", not "lost".
    this.data.opportunityStageChanges.push({
      id: uid('stg'), opportunityId: opp.id, fromStageKey: null, toStageKey: stageKey,
      changedAt: opp.createdAt, changedBy: null, note: 'Opportunity created',
    })
    return opp
  }

  async updateOpportunity(id: string, patch: Partial<Opportunity>) {
    const opp = this.data.opportunities.find((o) => o.id === id)!
    const bidOfOpp = this.data.bids.find((b) => b.opportunityId === id)
    if (bidOfOpp) this.assertNotProtected(bidOfOpp.id, (['valueAmount', 'emdAmount', 'gemTenderId'] as const).filter((f) => f in patch))
    const previousStage = opp.stageKey
    Object.assign(opp, patch)
    // A stage change is a logged event, not a silent field write — this log
    // is the only way "what was the pipeline on <date>?" is ever answerable.
    if (patch.stageKey !== undefined && patch.stageKey !== previousStage) {
      const nowClosed = PIPELINE_STAGE_MAP[opp.stageKey]?.isClosed ?? false
      opp.closedOn = nowClosed ? opp.closedOn ?? isoToday() : null
      this.data.opportunityStageChanges.push({
        id: uid('stg'), opportunityId: opp.id, fromStageKey: previousStage,
        toStageKey: opp.stageKey, changedAt: isoToday(), changedBy: null, note: '',
      })
    }
    return opp
  }

  async deleteOpportunity(id: string) {
    this.data.opportunities = this.data.opportunities.filter((o) => o.id !== id)
    this.data.opportunityStageChanges = this.data.opportunityStageChanges.filter((c) => c.opportunityId !== id)
  }

  // --- Bid Tracker -----------------------------------------------------------

  private attentionFor(bidId: string): BidGridRow['attentionFlag'] {
    const deadline = this.data.bidMilestones.find(
      (m) => m.bidId === bidId && m.key === 'submissionDeadline' && m.status === 'open',
    )
    const corrigendumIds = new Set(this.data.bidCorrigenda.filter((c) => c.bidId === bidId).map((c) => c.id))
    const hasPendingCorrigendum = this.data.bidCorrigendumChanges.some(
      (c) => corrigendumIds.has(c.corrigendumId) && c.decision === 'pending',
    )
    return computeAttentionFlag({ dueAt: deadline?.dueAt ?? null, hasPendingCorrigendum, today: isoToday() })
  }

  /** Mirrors the API's assertFieldsNotProtected (spec §13): a frozen field on a
   *  bid rejects direct edits until it is unfrozen. */
  private assertNotProtected(bidId: string, fieldKeys: string[]) {
    const frozen = this.data.protectedValues.find(
      (p) => p.entityType === 'bid' && p.entityId === bidId && p.frozen && fieldKeys.includes(p.fieldKey),
    )
    if (frozen) throw new Error(`"${frozen.fieldKey}" is protected — unfreeze it first.`)
  }

  private requireBid(id: string): Bid {
    const bid = this.data.bids.find((b) => b.id === id)
    if (!bid) throw new Error(`No such bid: ${id}`)
    return bid
  }

  private joinCorrigendum(c: Omit<BidCorrigendum, 'changes'>): BidCorrigendum {
    return { ...c, changes: this.data.bidCorrigendumChanges.filter((ch) => ch.corrigendumId === c.id) }
  }

  async listBidsForGrid(filterRules: SystemBidViewFilterRule[] = []) {
    const today = isoToday()
    const owners = buildOwnerMap(
      this.data.ownershipAssignments, 'bid', this.data.bids.map((b) => b.id), today, this.ownershipContext(),
    )
    // Active custom columns only — an archived column's values are retained
    // but never surface in the grid or in filtering (spec §8.1).
    const activeFields = this.data.bidCustomFields.filter((f) => f.status === 'active')
    const activeFieldById = new Map(activeFields.map((f) => [f.id, f]))
    const fieldTypes: Record<string, CustomFieldType> = {}
    for (const f of activeFields) fieldTypes[`custom:${f.key}`] = f.dataType
    const customValuesByBid = new Map<string, Record<string, CustomValue>>()
    for (const v of this.data.bidCustomFieldValues) {
      const field = activeFieldById.get(v.fieldId)
      if (!field) continue
      const forBid = customValuesByBid.get(v.bidId) ?? {}
      forBid[field.key] = v.value
      customValuesByBid.set(v.bidId, forBid)
    }
    const rows: BidGridRow[] = this.data.bids.map((bid) => {
      const opp = this.data.opportunities.find((o) => o.id === bid.opportunityId)
      const ownerId = owners.get(bid.id)?.salesPersonId
      const emailOf = (personId: string | null | undefined) =>
        personId ? this.data.salesPersons.find((p) => p.id === personId)?.officialEmail ?? null : null
      const ownerEmail = emailOf(ownerId)
      const solutionLead = this.data.ownershipAssignments.find(
        (a) => a.entityType === 'bid' && a.entityId === bid.id && a.role === 'solutionLead' && a.endDate === null,
      )
      const bidCorrigenda = this.data.bidCorrigenda.filter((c) => c.bidId === bid.id)
      const latestCorrigendum = bidCorrigenda.reduce<(typeof bidCorrigenda)[number] | null>(
        (best, c) => (!best || c.corrigendumNumber > best.corrigendumNumber ? c : best), null,
      )
      const nextMilestone = this.data.bidMilestones
        .filter((m) => m.bidId === bid.id && m.status === 'open')
        .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))[0]
      const nextAction = this.data.followUps
        .filter((f) => f.entityType === 'bid' && f.entityId === bid.id && f.status === 'open')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
      return {
        ...bid,
        departmentId: opp?.departmentId ?? '',
        departmentName: this.data.nodes.find((n) => n.id === opp?.departmentId)?.name ?? null,
        stateCode: opp?.stateCode ?? null,
        city: opp?.city ?? null,
        opportunityName: opp?.opportunityName ?? '',
        gemTenderId: opp?.gemTenderId ?? '',
        submissionDate: opp?.submissionDate ?? '',
        valueAmount: opp?.valueAmount ?? '',
        valueUnit: opp?.valueUnit ?? '',
        emdAmount: opp?.emdAmount ?? '',
        emdUnit: opp?.emdUnit ?? '',
        vertical: opp?.vertical ?? '',
        ownerEmail,
        solutionLeadEmail: emailOf(solutionLead?.salesPersonId),
        documentCount: this.data.bidDocuments.filter((d) => d.entityType === 'bid' && d.entityId === bid.id).length,
        latestCorrigendumStatus: latestCorrigendum
          ? (this.data.bidCorrigendumChanges.some((c) => c.corrigendumId === latestCorrigendum.id && c.decision === 'pending')
            ? 'pending_review' : 'reviewed')
          : null,
        nextMilestoneLabel: nextMilestone?.label ?? null,
        nextMilestoneDueAt: nextMilestone?.dueAt ?? null,
        daysRemaining: nextMilestone?.dueAt
          ? Math.ceil((new Date(nextMilestone.dueAt).getTime() - Date.now()) / 86_400_000)
          : null,
        nextActionNote: nextAction?.note ?? null,
        nextActionDueDate: nextAction?.dueDate ?? null,
        nextActionAssigneeEmail: emailOf(nextAction?.assigneeId),
        // The local store has no signed-in user, so no audit row ever carries
        // an author — there is nothing real to show here.
        updatedBy: null,
        attentionFlag: this.attentionFor(bid.id),
        customValues: customValuesByBid.get(bid.id) ?? {},
      }
    })
    // Local dev has no signed-in user, so "$currentUser" never matches.
    return applyFilterRules(rows as unknown as Record<string, unknown>[], filterRules, null, fieldTypes) as unknown as BidGridRow[]
  }

  async getBid(id: string) {
    return this.data.bids.find((b) => b.id === id) ?? null
  }

  async getBidForOpportunity(opportunityId: string) {
    return this.data.bids.find((b) => b.opportunityId === opportunityId) ?? null
  }

  async createBid(opportunityId: string) {
    const opp = this.data.opportunities.find((o) => o.id === opportunityId)
    if (!opp) throw new Error(`No such opportunity: ${opportunityId}`)
    if (this.data.bids.some((b) => b.opportunityId === opportunityId)) {
      throw new Error('This opportunity already has a bid.')
    }
    const now = new Date().toISOString()
    const bid: Bid = {
      id: uid('bid'),
      opportunityId,
      bidCode: formatBidCode(new Date().getFullYear(), inMemoryBidSeq++),
      stageKey: DEFAULT_BID_STAGE_KEY,
      decision: 'pending',
      status: 'active',
      dataConfidence: 'verified',
      tenderLink: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.data.bids.push(bid)
    this.data.bidMilestones.push({
      id: uid('bms'), bidId: bid.id, milestoneType: 'submissionDeadline', key: 'submissionDeadline',
      label: 'Submission Deadline', dueAt: parseSubmissionDate(opp.submissionDate), venue: null, notes: null,
      status: 'open', source: 'manual', createdAt: now, updatedAt: now,
    })
    return bid
  }

  async updateBid(id: string, patch: Partial<Pick<Bid, 'stageKey' | 'decision' | 'tenderLink'>>) {
    const bid = this.requireBid(id)
    const next = { ...patch }
    const effectiveStageKey = next.stageKey ?? bid.stageKey
    if (next.decision === 'go' && !isAtOrAfterSubmitted(effectiveStageKey)) {
      throw new Error('Cannot mark Go before the bid reaches Submitted.')
    }
    // A final decision always wins over a stageKey in the same patch, so the
    // two fields can never visibly disagree (spec §4.4).
    if (next.decision === 'go') next.stageKey = 'goApproved'
    if (next.decision === 'no_go') next.stageKey = 'dropped'
    this.assertNotProtected(id, Object.keys(next))
    // One audit entry per patched field (like the API), so Activity History has
    // real bid edits to show in local mode too.
    for (const field of Object.keys(next) as (keyof typeof next)[]) {
      const before = bid[field] == null ? '' : String(bid[field])
      const after = next[field] == null ? '' : String(next[field])
      if (before !== after) {
        this.auditCustom({ entityType: 'bid', entityId: id, field, oldValue: before, newValue: after, action: 'update' })
      }
    }
    Object.assign(bid, next, { updatedAt: new Date().toISOString() })
    return bid
  }

  async archiveBid(id: string) {
    const bid = this.requireBid(id)
    bid.status = 'archived'
    bid.archivedAt = new Date().toISOString()
    bid.updatedAt = bid.archivedAt
    return bid
  }

  async markBidVerified(id: string) {
    const bid = this.requireBid(id)
    const corrigendumIds = new Set(this.data.bidCorrigenda.filter((c) => c.bidId === id).map((c) => c.id))
    if (this.data.bidCorrigendumChanges.some((ch) => corrigendumIds.has(ch.corrigendumId) && ch.decision === 'pending')) {
      throw new Error('This bid has a pending corrigendum change — resolve it before marking verified.')
    }
    if (bid.dataConfidence !== 'verified') {
      bid.dataConfidence = 'verified'
      bid.updatedAt = new Date().toISOString()
      this.auditCustom({ entityType: 'bid', entityId: id, field: 'dataConfidence', oldValue: 'needs_review', newValue: 'verified', action: 'mark_verified' })
    }
    return bid
  }

  async unarchiveBid(id: string) {
    const bid = this.requireBid(id)
    bid.status = 'active'
    bid.archivedAt = null
    bid.updatedAt = new Date().toISOString()
    return bid
  }

  async deleteBid(id: string) {
    this.requireBid(id)
    const referenced =
      this.data.bidCorrigenda.some((c) => c.bidId === id)
      || this.data.protectedValues.some((p) => p.entityType === 'bid' && p.entityId === id)
      || this.data.bidDocuments.some((d) => d.entityType === 'bid' && d.entityId === id)
      || this.data.followUps.some((f) => f.entityType === 'bid' && f.entityId === id)
    if (referenced) throw new Error('This bid has corrigenda, protected values, documents or follow-ups — archive it instead.')
    this.data.bids = this.data.bids.filter((b) => b.id !== id)
    this.data.bidMilestones = this.data.bidMilestones.filter((m) => m.bidId !== id)
    // Mirrors the backend's ON DELETE CASCADE on bid_custom_field_values.
    this.data.bidCustomFieldValues = this.data.bidCustomFieldValues.filter((v) => v.bidId !== id)
  }

  async listBidActionQueue() {
    const today = isoToday()
    const out: ActionQueueEntry[] = []
    for (const f of this.data.followUps) {
      if (f.entityType !== 'bid' || f.status !== 'open') continue
      const bid = this.data.bids.find((b) => b.id === f.entityId)
      if (!bid || bid.status !== 'active') continue
      const opp = this.data.opportunities.find((o) => o.id === bid.opportunityId)
      out.push({
        followUpId: f.id, bidId: bid.id, bidCode: bid.bidCode, stageKey: bid.stageKey,
        opportunityName: opp?.opportunityName ?? '', dueDate: f.dueDate, note: f.note, assigneeId: f.assigneeId,
        attentionFlag: computeAttentionFlag({
          dueAt: f.dueDate, hasPendingCorrigendum: this.attentionFor(bid.id) === 'corrigendumPending', today,
        }),
      })
    }
    return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  async listAllBidMilestones(): Promise<BidMilestoneWithBid[]> {
    const out: BidMilestoneWithBid[] = []
    for (const m of this.data.bidMilestones) {
      const bid = this.data.bids.find((b) => b.id === m.bidId)
      if (!bid || bid.status !== 'active' || m.status === 'superseded') continue
      const opp = this.data.opportunities.find((o) => o.id === bid.opportunityId)
      out.push({ ...m, bidCode: bid.bidCode, opportunityName: opp?.opportunityName ?? '' })
    }
    return out.sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.createdAt.localeCompare(b.createdAt))
  }

  async listBidMilestones(bidId: string) {
    return this.data.bidMilestones
      .filter((m) => m.bidId === bidId)
      .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.createdAt.localeCompare(b.createdAt))
  }

  async createBidMilestone(input: {
    bidId: string; milestoneType: string; key: string; label: string
    dueAt?: string | null; venue?: string; notes?: string
  }) {
    this.requireBid(input.bidId)
    if (this.data.bidMilestones.some((m) => m.bidId === input.bidId && m.key === input.key)) {
      throw new Error(`Milestone "${input.key}" already exists for this bid.`)
    }
    const now = new Date().toISOString()
    const milestone: BidMilestone = {
      id: uid('bms'), bidId: input.bidId, milestoneType: input.milestoneType, key: input.key, label: input.label,
      dueAt: input.dueAt ?? null, venue: input.venue ?? null, notes: input.notes ?? null,
      status: 'open', source: 'manual', createdAt: now, updatedAt: now,
    }
    this.data.bidMilestones.push(milestone)
    return milestone
  }

  async updateBidMilestone(
    id: string,
    patch: Partial<Pick<BidMilestone, 'label' | 'dueAt' | 'venue' | 'notes' | 'status'>>,
  ) {
    const m = this.data.bidMilestones.find((x) => x.id === id)
    if (!m) throw new Error(`No such milestone: ${id}`)
    // Only a change to the milestone's DATE touches the protected fact; status/notes edits don't.
    if (patch.dueAt !== undefined && patch.dueAt !== m.dueAt) this.assertNotProtected(m.bidId, [m.key])
    Object.assign(m, patch, { updatedAt: new Date().toISOString() })
    return m
  }

  async deleteBidMilestone(id: string) {
    const m = this.data.bidMilestones.find((x) => x.id === id)
    if (!m) return
    // A pending corrigendum change still targets this slot — deleting it
    // would leave the change with nowhere to land.
    const targeted = this.data.bidCorrigendumChanges.some((ch) => {
      if (ch.decision !== 'pending' || ch.fieldKey !== m.key) return false
      return this.data.bidCorrigenda.some((c) => c.id === ch.corrigendumId && c.bidId === m.bidId)
    })
    if (targeted) throw new Error('A pending corrigendum still targets this milestone.')
    this.data.bidMilestones = this.data.bidMilestones.filter((x) => x.id !== id)
  }

  async listBidCorrigenda(bidId: string) {
    return this.data.bidCorrigenda
      .filter((c) => c.bidId === bidId)
      .sort((a, b) => a.corrigendumNumber - b.corrigendumNumber)
      .map((c) => this.joinCorrigendum(c))
  }

  async createBidCorrigendum(input: {
    bidId: string; corrigendumNumber: number; sourceDocumentId?: string
    changes: { fieldKey: string; currentValue: string; proposedValue: string }[]
  }) {
    const bid = this.requireBid(input.bidId)
    if (!input.changes.length) throw new Error('A corrigendum needs at least one change.')
    if (this.data.bidCorrigenda.some((c) => c.bidId === input.bidId && c.corrigendumNumber === input.corrigendumNumber)) {
      throw new Error(`Corrigendum ${input.corrigendumNumber} already exists for this bid.`)
    }
    for (const ch of input.changes) {
      if (ch.fieldKey === 'tenderLink') continue
      if (!this.data.bidMilestones.some((m) => m.bidId === input.bidId && m.key === ch.fieldKey)) {
        throw new Error(`Unknown field "${ch.fieldKey}" — create its milestone slot first.`)
      }
    }
    const corrigendum: Omit<BidCorrigendum, 'changes'> = {
      id: uid('cor'), bidId: input.bidId, corrigendumNumber: input.corrigendumNumber,
      sourceDocumentId: input.sourceDocumentId ?? null, detectedAt: new Date().toISOString(),
      reviewedAt: null, reviewedBy: null, status: 'pending_review',
    }
    this.data.bidCorrigenda.push(corrigendum)
    for (const ch of input.changes) {
      this.data.bidCorrigendumChanges.push({
        id: uid('cch'), corrigendumId: corrigendum.id, ...ch, decision: 'pending', decidedAt: null, decidedBy: null,
      })
    }
    bid.dataConfidence = 'needs_review'
    bid.updatedAt = new Date().toISOString()
    return this.joinCorrigendum(corrigendum)
  }

  async reviewCorrigendumChange(input: { changeId: string; decision: 'accepted' | 'rejected'; reason?: string }) {
    const change = this.data.bidCorrigendumChanges.find((c) => c.id === input.changeId)
    if (!change) throw new Error(`No such corrigendum change: ${input.changeId}`)
    const corrigendum = this.data.bidCorrigenda.find((c) => c.id === change.corrigendumId)!
    const bid = this.requireBid(corrigendum.bidId)
    const now = new Date().toISOString()

    if (input.decision === 'accepted') {
      const frozen = this.data.protectedValues.some(
        (p) => p.entityType === 'bid' && p.entityId === bid.id && p.fieldKey === change.fieldKey && p.frozen,
      )
      if (frozen) throw new Error(`"${change.fieldKey}" is frozen — unfreeze it before accepting this change.`)
      if (change.fieldKey === 'tenderLink') {
        bid.tenderLink = change.proposedValue
        bid.updatedAt = now
      } else {
        const milestone = this.data.bidMilestones.find((m) => m.bidId === bid.id && m.key === change.fieldKey)
        if (milestone) {
          milestone.dueAt = change.proposedValue
          milestone.source = 'corrigendum'
          milestone.updatedAt = now
        }
        if (change.fieldKey === 'submissionDeadline') {
          const opp = this.data.opportunities.find((o) => o.id === bid.opportunityId)
          if (opp) opp.submissionDate = change.proposedValue.slice(0, 10)
        }
      }
    }

    change.decision = input.decision
    change.decidedAt = now
    change.decidedBy = null

    const stillPending = this.data.bidCorrigendumChanges.some(
      (c) => c.corrigendumId === corrigendum.id && c.decision === 'pending',
    )
    if (!stillPending) {
      corrigendum.status = 'reviewed'
      corrigendum.reviewedAt = now
      // Like the API, resolving every change does NOT clear needs_review — a person confirms it via markBidVerified.
    }
    return change
  }

  async listProtectedValues(entityType: string, entityId: string) {
    return this.data.protectedValues.filter((p) => p.entityType === entityType && p.entityId === entityId)
  }

  async freezeValue(entityType: string, entityId: string, fieldKey: string) {
    const now = new Date().toISOString()
    const existing = this.data.protectedValues.find(
      (p) => p.entityType === entityType && p.entityId === entityId && p.fieldKey === fieldKey,
    )
    if (existing) {
      existing.frozen = true
      existing.frozenAt = now
      return
    }
    this.data.protectedValues.push({
      id: uid('pv'), entityType, entityId, fieldKey, frozen: true, frozenAt: now, frozenBy: null,
    })
  }

  async unfreezeValue(entityType: string, entityId: string, fieldKey: string, reason: string) {
    if (!reason.trim()) throw new Error('A reason is required to unfreeze a value.')
    const pv = this.data.protectedValues.find(
      (p) => p.entityType === entityType && p.entityId === entityId && p.fieldKey === fieldKey,
    )
    if (!pv) return
    pv.frozen = false
    pv.frozenAt = null
    pv.frozenBy = null
  }

  async requestDocumentUploadUrl(input: {
    entityType: string; entityId: string; filename: string; contentType: string; sizeBytes: number; version?: string
  }) {
    // Local dev has no object storage: the "upload URL" is a placeholder and
    // the file bytes are never stored — only the metadata row.
    const uploadId = uid('upl')
    pendingBidUploads.set(uploadId, input)
    return { uploadId, uploadUrl: `local://bid-upload/${uploadId}` }
  }

  async confirmDocumentUpload(uploadId: string) {
    const pending = pendingBidUploads.get(uploadId)
    if (!pending) throw new Error(`No such upload: ${uploadId}`)
    pendingBidUploads.delete(uploadId)
    const doc: BidDocument = {
      id: uid('doc'), entityType: pending.entityType, entityId: pending.entityId, filename: pending.filename,
      storagePath: `local://${pending.entityType}/${pending.entityId}/${pending.filename}`,
      version: pending.version ?? '1', contentType: pending.contentType, sizeBytes: pending.sizeBytes,
      uploadedBy: null, uploadedAt: new Date().toISOString(),
    }
    this.data.bidDocuments.push(doc)
    return doc
  }

  async listDocuments(entityType: string, entityId: string) {
    return this.data.bidDocuments
      .filter((d) => d.entityType === entityType && d.entityId === entityId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  }

  async deleteDocument(id: string) {
    this.data.bidDocuments = this.data.bidDocuments.filter((d) => d.id !== id)
    this.data.documentCitations = this.data.documentCitations.filter((c) => c.documentId !== id)
  }

  /** Local mode stores no file bytes, so there is nothing to open: the `local://` URL
   *  tells the UI to say so instead of opening a dead link. */
  async getDocumentDownloadUrl(id: string) {
    const doc = this.data.bidDocuments.find((d) => d.id === id)
    if (!doc) throw new Error(`No such document: ${id}`)
    return doc.storagePath
  }

  async deleteDocumentCitation(id: string) {
    this.data.documentCitations = this.data.documentCitations.filter((c) => c.id !== id)
  }

  async listDocumentCitations(documentId: string) {
    return this.data.documentCitations.filter((c) => c.documentId === documentId)
  }

  async createDocumentCitation(input: { documentId: string; pageLabel: string; quoteText?: string; fieldRef?: string }) {
    if (!this.data.bidDocuments.some((d) => d.id === input.documentId)) {
      throw new Error(`No such document: ${input.documentId}`)
    }
    const citation: DocumentCitation = {
      id: uid('cit'), documentId: input.documentId, pageLabel: input.pageLabel,
      quoteText: input.quoteText ?? '', fieldRef: input.fieldRef ?? null, createdAt: new Date().toISOString(),
    }
    this.data.documentCitations.push(citation)
    return citation
  }

  async listBidSavedViews() {
    const system: BidSavedView[] = SYSTEM_BID_VIEWS.map((v) => ({
      id: v.key, name: v.name, scope: 'global', ownerEmail: null, isSystem: true,
      filterRules: v.filterRules, sort: [], visibleColumns: [], createdBy: null, createdAt: null, updatedAt: null,
    }))
    // Copies for the same reason as listBidCustomFields (in-place updates vs structural sharing).
    return [...system, ...this.data.bidSavedViews.map((v) => ({ ...v, filterRules: [...v.filterRules], visibleColumns: [...v.visibleColumns] }))]
  }

  async createBidSavedView(input: {
    name: string; scope: 'personal' | 'global'
    filterRules?: SystemBidViewFilterRule[]; sort?: unknown[]; visibleColumns?: string[]
  }) {
    const now = new Date().toISOString()
    const view: BidSavedView = {
      id: uid('bsv'), name: input.name, scope: input.scope, ownerEmail: null, isSystem: false,
      filterRules: input.filterRules ?? [], sort: input.sort ?? [], visibleColumns: input.visibleColumns ?? [],
      createdBy: null, createdAt: now, updatedAt: now,
    }
    this.data.bidSavedViews.push(view)
    return view
  }

  async updateBidSavedView(
    id: string,
    patch: Partial<Pick<BidSavedView, 'name' | 'filterRules' | 'sort' | 'visibleColumns'>>,
  ) {
    if (SYSTEM_BID_VIEW_KEYS.has(id)) throw new Error('System views cannot be edited.')
    const view = this.data.bidSavedViews.find((v) => v.id === id)
    if (!view) throw new Error(`No such view: ${id}`)
    Object.assign(view, patch, { updatedAt: new Date().toISOString() })
    return view
  }

  async deleteBidSavedView(id: string) {
    if (SYSTEM_BID_VIEW_KEYS.has(id)) throw new Error('System views cannot be deleted.')
    this.data.bidSavedViews = this.data.bidSavedViews.filter((v) => v.id !== id)
  }

  // --- Bid Tracker: custom columns (spec §8.1) — same rules as the backend's
  // bidCustomFields router, using the same @goms/domain helpers. ------------

  private auditCustom(entry: { entityType: string; entityId: string; field: string; oldValue: string; newValue: string; action: string; reason?: string }) {
    writeAuditLogEntry(this.data.commercialCalculator, { reason: '', changedBy: null, ...entry })
  }

  private requireCustomField(id: string): BidCustomField {
    const field = this.data.bidCustomFields.find((f) => f.id === id)
    if (!field) throw new Error('No such custom column.')
    return field
  }

  private assertActiveNameFree(name: string, exceptId?: string) {
    const folded = name.trim().toLowerCase()
    const clash = this.data.bidCustomFields.some(
      (f) => f.status === 'active' && f.id !== exceptId && f.name.trim().toLowerCase() === folded,
    )
    if (clash) throw new Error(`A column named "${name.trim()}" already exists.`)
  }

  async listBidCustomFields(includeArchived = false) {
    // Copies, not the live stored objects: other methods mutate them in place,
    // and react-query's structural sharing would otherwise see "no change" after
    // a rename/archive and never re-render anything reading this list.
    return this.data.bidCustomFields
      .filter((f) => includeArchived || f.status === 'active')
      .map((f) => ({ ...f, options: f.options ? [...f.options] : null }))
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
  }

  async createBidCustomField(input: { name: string; dataType: CustomFieldType; options?: string[] }) {
    const name = input.name.trim()
    if (!name || name.length > 80) throw new Error('A column name must be 1–80 characters.')
    let options: string[] | null = null
    if (input.dataType === 'select') options = normalizeOptions(input.options ?? [])
    else if (input.options !== undefined) throw new Error('Only a select column has options.')
    this.assertActiveNameFree(name)
    const now = new Date().toISOString()
    const field: BidCustomField = {
      id: uid('bcf'),
      key: slugifyFieldKey(name, new Set(this.data.bidCustomFields.map((f) => f.key))),
      name, dataType: input.dataType, options, hasHeldValue: false,
      position: this.data.bidCustomFields.reduce((max, f) => Math.max(max, f.position), -1) + 1,
      status: 'active', createdBy: null, updatedBy: null, createdAt: now, updatedAt: now,
    }
    this.data.bidCustomFields.push(field)
    this.auditCustom({ entityType: 'bidCustomField', entityId: field.id, field: 'name', oldValue: '', newValue: name, action: 'custom_field_created' })
    return field
  }

  async updateBidCustomField(id: string, patch: { name?: string; options?: string[] }) {
    const field = this.requireCustomField(id)
    const now = new Date().toISOString()
    if (patch.name !== undefined && patch.name.trim() !== field.name) {
      const name = patch.name.trim()
      if (!name || name.length > 80) throw new Error('A column name must be 1–80 characters.')
      if (field.status === 'active') this.assertActiveNameFree(name, id)
      this.auditCustom({ entityType: 'bidCustomField', entityId: id, field: 'name', oldValue: field.name, newValue: name, action: 'custom_field_renamed' })
      field.name = name
      field.updatedAt = now
    }
    if (patch.options !== undefined) {
      if (field.dataType !== 'select') throw new Error('Only a select column has options.')
      const next = normalizeOptions(patch.options)
      const prev = field.options ?? []
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        const removed = prev.filter((o) => !next.includes(o))
        this.auditCustom({
          entityType: 'bidCustomField', entityId: id, field: 'options', oldValue: JSON.stringify(prev), newValue: JSON.stringify(next),
          reason: removed.length ? `Removed: ${removed.join(', ')} (existing values kept)` : '', action: 'custom_field_options_changed',
        })
        field.options = next
        field.updatedAt = now
      }
    }
    return field
  }

  async reorderBidCustomFields(ids: string[]) {
    const active = this.data.bidCustomFields.filter((f) => f.status === 'active')
    const activeIds = new Set(active.map((f) => f.id))
    if (ids.length !== activeIds.size || new Set(ids).size !== ids.length || !ids.every((id) => activeIds.has(id))) {
      throw new Error('ids must be exactly the current active columns, each once.')
    }
    for (const [index, id] of ids.entries()) {
      const field = this.requireCustomField(id)
      if (field.position === index) continue
      this.auditCustom({
        entityType: 'bidCustomField', entityId: id, field: 'position', oldValue: String(field.position), newValue: String(index),
        action: 'custom_field_reordered',
      })
      field.position = index
      field.updatedAt = new Date().toISOString()
    }
    return this.listBidCustomFields()
  }

  async archiveBidCustomField(id: string) {
    const field = this.requireCustomField(id)
    if (field.status === 'archived') return field
    field.status = 'archived'
    field.updatedAt = new Date().toISOString()
    this.auditCustom({
      entityType: 'bidCustomField', entityId: id, field: 'status', oldValue: 'active', newValue: 'archived',
      reason: 'Values are kept', action: 'custom_field_archived',
    })
    return field
  }

  async unarchiveBidCustomField(id: string) {
    const field = this.requireCustomField(id)
    if (field.status === 'active') return field
    if (this.data.bidCustomFields.some((f) => f.status === 'active' && f.name.trim().toLowerCase() === field.name.trim().toLowerCase())) {
      throw new Error(`Another active column is already named "${field.name}" — rename one of them first.`)
    }
    field.status = 'active'
    field.updatedAt = new Date().toISOString()
    this.auditCustom({ entityType: 'bidCustomField', entityId: id, field: 'status', oldValue: 'archived', newValue: 'active', action: 'custom_field_unarchived' })
    return field
  }

  async deleteBidCustomField(id: string) {
    const field = this.requireCustomField(id)
    // Never-held-a-value rule: clearing a value removes its row but not the flag.
    if (field.hasHeldValue || this.data.bidCustomFieldValues.some((v) => v.fieldId === id)) {
      throw new Error('This column has values — archive it instead.')
    }
    this.data.bidCustomFields = this.data.bidCustomFields.filter((f) => f.id !== id)
    this.auditCustom({
      entityType: 'bidCustomField', entityId: id, field: 'name', oldValue: field.name, newValue: '',
      reason: 'Never held a value', action: 'custom_field_deleted',
    })
  }

  async setBidCustomValue(bidId: string, fieldId: string, raw: string | number | boolean | null) {
    const field = this.requireCustomField(fieldId)
    if (field.status === 'archived') throw new Error('This column is archived.')
    this.requireBid(bidId)
    const value = coerceCustomValue(field.dataType, raw, field.options)
    const existing = this.data.bidCustomFieldValues.find((v) => v.bidId === bidId && v.fieldId === fieldId)
    const oldValue: CustomValue = existing?.value ?? null
    const text = (v: CustomValue) => (v === null ? '' : String(v))
    // entityId is the BID so the edit shows in that bid's Activity History.
    const audit = (action: string) => this.auditCustom({
      entityType: 'bidCustomFieldValue', entityId: bidId, field: field.key, oldValue: text(oldValue), newValue: text(value), action,
    })
    const touch = () => { this.requireBid(bidId).updatedAt = new Date().toISOString() }

    if (value === null) {
      if (existing) {
        this.data.bidCustomFieldValues = this.data.bidCustomFieldValues.filter((v) => v !== existing)
        audit('custom_value_cleared')
        touch()
      }
      return { bidId, fieldId, key: field.key, value: null as CustomValue }
    }
    field.hasHeldValue = true
    const now = new Date().toISOString()
    if (existing) {
      existing.value = value
      existing.updatedAt = now
    } else {
      const row: BidCustomFieldValue = { bidId, fieldId, value, updatedAt: now }
      this.data.bidCustomFieldValues.push(row)
    }
    if (oldValue !== value) {
      audit('custom_value_set')
      touch()
    }
    return { bidId, fieldId, key: field.key, value }
  }

  async listBidCustomValues(bidId: string) {
    const out: Record<string, CustomValue> = {}
    for (const v of this.data.bidCustomFieldValues) {
      if (v.bidId !== bidId) continue
      const field = this.data.bidCustomFields.find((f) => f.id === v.fieldId)
      if (field?.status === 'active') out[field.key] = v.value
    }
    return out
  }

  async listSalesPersons() {
    return [...this.data.salesPersons].sort((a, b) => a.name.localeCompare(b.name))
  }

  async getSalesPerson(id: string) {
    return this.data.salesPersons.find((p) => p.id === id) ?? null
  }

  async listSalesPostings(salesPersonId: string) {
    return this.data.salesPostings
      .filter((p) => p.salesPersonId === salesPersonId)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
  }

  async currentPostings() {
    const out: Record<string, SalesPosting> = {}
    for (const p of this.data.salesPostings) {
      if (p.endDate === null) out[p.salesPersonId] = p
    }
    return out
  }

  /** The slices ownership resolution walks. Rebuilt per call rather than
   *  cached: these arrays are mutated in place by other methods, so a cached
   *  context would silently go stale. */
  private ownershipContext(): OwnershipContext {
    return { nodes: this.data.nodes, employees: this.data.employees, opportunities: this.data.opportunities, bids: this.data.bids }
  }

  async listOwnershipAssignments() {
    return [...this.data.ownershipAssignments].sort((a, b) => b.startDate.localeCompare(a.startDate))
  }

  async listOwnershipFor(entityType: string, entityId: string) {
    return this.data.ownershipAssignments
      .filter((a) => a.entityType === entityType && a.entityId === entityId)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
  }

  async listOwnedBy(salesPersonId: string, asOf: string) {
    return this.data.ownershipAssignments.filter(
      (a) => a.salesPersonId === salesPersonId && coversDate(a, asOf),
    )
  }

  async createSalesPerson(input: CreateSalesPersonInput) {
    const person: SalesPerson = {
      id: uid('sp'),
      employeeCode: '',
      name: input.name,
      officialEmail: input.officialEmail,
      personalEmail: input.personalEmail ?? '',
      mobile: input.mobile ?? '',
      altMobile: input.altMobile ?? '',
      joinedOn: null,
      leftOn: null,
      status: 'active',
      photoUrl: input.photoUrl ?? null,
      notes: input.notes ?? '',
      metadata: {},
      createdAt: isoToday(),
      createdBy: null,
    }
    this.data.salesPersons.push(person)
    this.data.salesPostings.push({
      id: uid('spost'),
      salesPersonId: person.id,
      designation: input.designation,
      tierKey: input.tierKey,
      managerId: input.managerId ?? null,
      gmOverrideId: null,
      office: '',
      startDate: isoToday(),
      endDate: null,
      changeType: 'initial',
      reason: '',
      createdAt: isoToday(),
      createdBy: null,
    })
    return person
  }

  /** Closes the current open posting and opens a new one — a promotion,
   *  demotion, or lateral move, per spec §6.3. `changeType` is derived from
   *  comparing tier rank across the two postings, never typed by the caller. */
  async transferSalesPerson(input: TransferSalesPersonInput) {
    const person = this.data.salesPersons.find((p) => p.id === input.salesPersonId)
    if (!person) throw new Error(`No such salesperson: ${input.salesPersonId}`)

    const current = this.data.salesPostings.find(
      (p) => p.salesPersonId === input.salesPersonId && p.endDate === null,
    )
    if (current) {
      if (input.effectiveDate <= current.startDate) {
        throw new Error(`The current posting starts on ${current.startDate}; a transfer must take effect after that.`)
      }
      current.endDate = input.effectiveDate
    }

    const oldRank = current ? tierRank(current.tierKey) : null
    const newRank = tierRank(input.tierKey)
    const changeType: SalesPosting['changeType'] =
      oldRank === null ? 'initial' : newRank < oldRank ? 'promotion' : newRank > oldRank ? 'demotion' : 'lateralMove'

    const posting: SalesPosting = {
      id: uid('spost'),
      salesPersonId: input.salesPersonId,
      designation: input.designation,
      tierKey: input.tierKey,
      managerId: input.managerId ?? null,
      // A reorg/promotion is exactly the kind of change that should force a
      // fresh look at who the GM really is — never silently carry a stale
      // override from the closed posting into the new one.
      gmOverrideId: null,
      office: input.office ?? '',
      startDate: input.effectiveDate,
      endDate: null,
      changeType,
      reason: input.reason ?? '',
      createdAt: isoToday(),
      createdBy: null,
    }
    this.data.salesPostings.push(posting)
    return posting
  }

  /** In-place manager/GM-override change on the currently-open posting —
   *  distinct from `transferSalesPerson`, which closes the current posting
   *  and opens a new one. Does not touch designation/tier/start-end
   *  dates/changeType. */
  async updatePostingManager(personId: string, patch: { managerId?: string | null; gmOverrideId?: string | null }) {
    const posting = this.data.salesPostings.find((p) => p.salesPersonId === personId && p.endDate === null)
    if (!posting) throw new Error(`No open posting for salesperson: ${personId}`)
    if ('managerId' in patch) posting.managerId = patch.managerId ?? null
    if ('gmOverrideId' in patch) posting.gmOverrideId = patch.gmOverrideId ?? null
    return posting
  }

  async updatePostingDates(postingId: string, edit: PostingDatesEdit) {
    const posting = this.data.salesPostings.find((p) => p.id === postingId)
    if (!posting) throw new Error('That posting no longer exists.')
    const siblings = this.data.salesPostings.filter((p) => p.salesPersonId === posting.salesPersonId)
    const plan = planPostingDatesEdit(siblings, postingId, edit)
    if (plan.previous) {
      const prev = siblings.find((p) => p.id === plan.previous!.id)!
      prev.endDate = plan.previous.endDate
    }
    posting.startDate = plan.startDate
    posting.endDate = plan.endDate
    return posting
  }

  async updateSalesPerson(id: string, patch: Partial<SalesPerson>) {
    const person = this.data.salesPersons.find((p) => p.id === id)
    if (!person) throw new Error(`No such salesperson: ${id}`)
    Object.assign(person, patch)
    return person
  }

  async setSalesPersonStatus(id: string, status: SalesPerson['status']) {
    const person = this.data.salesPersons.find((p) => p.id === id)
    if (person) person.status = status
  }

  async deleteSalesPerson(id: string) {
    this.data.salesPersons = this.data.salesPersons.filter((p) => p.id !== id)
    this.data.salesPostings = this.data.salesPostings.filter((p) => p.salesPersonId !== id)
    this.data.ownershipAssignments = this.data.ownershipAssignments.filter((a) => a.salesPersonId !== id)
  }

  async listMaster<K extends MasterEntityKey>(key: K) {
    return listMasterLogic(this.data.commercialCalculator, key)
  }

  async getMaster<K extends MasterEntityKey>(key: K, id: string) {
    return getMasterLogic(this.data.commercialCalculator, key, id)
  }

  async createMaster<K extends MasterEntityKey>(key: K, input: CreateMasterInput<K>) {
    return createMasterLogic(this.data.commercialCalculator, key, input)
  }

  async updateMaster<K extends MasterEntityKey>(key: K, id: string, patch: Partial<MasterRowMap[K]>, changeReason?: string) {
    return updateMasterLogic(this.data.commercialCalculator, key, id, patch, changeReason)
  }

  async setMasterActive(key: MasterEntityKey, id: string, active: boolean) {
    return setMasterActiveLogic(this.data.commercialCalculator, key, id, active)
  }

  async deleteMaster(key: MasterEntityKey, id: string) {
    return deleteMasterLogic(this.data.commercialCalculator, key, id)
  }

  async listEditionFeatures(editionId: string) {
    return listEditionFeaturesLogic(this.data.commercialCalculator, editionId)
  }

  async setEditionFeatures(editionId: string, rows: { featureId: string; mandatory: boolean }[]) {
    return setEditionFeaturesLogic(this.data.commercialCalculator, editionId, rows)
  }

  async listSkus() {
    return listSkusLogic(this.data.commercialCalculator)
  }

  async getSku(id: string) {
    return getSkuLogic(this.data.commercialCalculator, id)
  }

  async createSku(input: CreateSkuInput) {
    return createSkuLogic(this.data.commercialCalculator, input)
  }

  async updateSku(id: string, patch: Partial<CommercialSku>, changeReason?: string) {
    return updateSkuLogic(this.data.commercialCalculator, id, patch, changeReason)
  }

  async deleteSku(id: string) {
    return deleteSkuLogic(this.data.commercialCalculator, id)
  }

  async listBomItemsForSku(parentSkuId: string) {
    return listBomItemsForSkuLogic(this.data.commercialCalculator, parentSkuId)
  }

  async listAllBomItems() {
    return listAllBomItemsLogic(this.data.commercialCalculator)
  }

  async createBomItem(input: CreateBomItemInput) {
    return createBomItemLogic(this.data.commercialCalculator, input)
  }

  async updateBomItem(id: string, patch: Partial<CommercialBomItem>) {
    return updateBomItemLogic(this.data.commercialCalculator, id, patch)
  }

  async deleteBomItem(id: string) {
    return deleteBomItemLogic(this.data.commercialCalculator, id)
  }

  async listBoqs() {
    return listBoqsLogic(this.data.commercialCalculator)
  }

  async getBoq(id: string) {
    return getBoqLogic(this.data.commercialCalculator, id)
  }

  async listBoqLineItems(boqId: string) {
    return listBoqLineItemsLogic(this.data.commercialCalculator, boqId)
  }

  async listAllBoqLineItems() {
    return listAllBoqLineItemsLogic(this.data.commercialCalculator)
  }

  async createBoq(input: CreateBoqInput) {
    return createBoqLogic(this.data.commercialCalculator, input)
  }

  async updateBoq(id: string, patch: UpdateBoqInput) {
    return updateBoqLogic(this.data.commercialCalculator, id, patch)
  }

  async addBoqLineItem(boqId: string, input: CreateBoqLineItemInput) {
    return addBoqLineItemLogic(this.data.commercialCalculator, boqId, input)
  }

  async updateBoqLineItem(
    id: string,
    patch: Partial<Pick<CommercialBoqLineItem,
      'quantity' | 'unitPrice' | 'discountPct' | 'approverId' | 'approvalDate' | 'approvalRemarks' | 'approvalStatus'
      | 'pricingLevels' | 'activePricingLevel'
    >>,
  ) {
    return updateBoqLineItemLogic(this.data.commercialCalculator, id, patch)
  }

  async removeBoqLineItem(id: string) {
    return removeBoqLineItemLogic(this.data.commercialCalculator, id)
  }

  async reorderBoqLineItems(boqId: string, orderedIds: string[]) {
    return reorderBoqLineItemsLogic(this.data.commercialCalculator, boqId, orderedIds)
  }

  async updateBoqStatus(id: string, nextStatus: BoqStatus, changeReason: string) {
    return updateBoqStatusLogic(this.data.commercialCalculator, id, nextStatus, changeReason)
  }

  async reviseBoq(id: string) {
    return reviseBoqLogic(this.data.commercialCalculator, id)
  }

  async duplicateBoq(id: string) {
    return duplicateBoqLogic(this.data.commercialCalculator, id)
  }

  async deleteBoq(id: string) {
    return deleteBoqLogic(this.data.commercialCalculator, id)
  }

  async listAuditLogs(filter?: { entityType?: string; entityId?: string }) {
    return listAuditLogsLogic(this.data.commercialCalculator, filter)
  }

  async resolveOwner(entityType: string, entityId: string, asOf: string) {
    return effectiveOwner(this.data.ownershipAssignments, entityType, entityId, asOf, this.ownershipContext())
  }

  async resolveOwners(entityType: string, entityIds: string[], asOf: string) {
    const map = buildOwnerMap(this.data.ownershipAssignments, entityType, entityIds, asOf, this.ownershipContext())
    return Object.fromEntries(map)
  }

  async assignOwner(input: AssignOwnerInput) {
    const role = input.role ?? 'owner'
    // Invariants are rejected writes, not warnings: a warning means the bad
    // data is already stored (spec §8).
    if (!this.data.salesPersons.some((p) => p.id === input.salesPersonId)) {
      throw new Error(`No such salesperson: ${input.salesPersonId}`)
    }
    if (!OWNABLE_ENTITY_MAP[input.entityType]) {
      throw new Error(`Not an ownable entity type: ${input.entityType}`)
    }
    if (role === 'delegate' && !input.endDate) {
      throw new Error('A delegation must have an end date')
    }
    if (input.endDate && input.endDate <= input.startDate) {
      throw new Error('An assignment cannot end on or before it starts')
    }

    // One open owner per entity. Reassigning closes the incumbent at the new
    // start date, which keeps the two intervals exactly adjacent — no gap, no
    // overlap — because the end is exclusive.
    if (role === 'owner') {
      for (const a of this.data.ownershipAssignments) {
        if (a.entityType !== input.entityType || a.entityId !== input.entityId) continue
        if (a.role !== 'owner' || a.endDate !== null) continue
        if (input.startDate <= a.startDate) {
          throw new Error(
            `The current owner's assignment starts on ${a.startDate}; a replacement must start after that.`,
          )
        }
        a.endDate = input.startDate
      }
    }

    const row: OwnershipAssignment = {
      id: uid('own'),
      entityType: input.entityType,
      entityId: input.entityId,
      salesPersonId: input.salesPersonId,
      role,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      reason: input.reason ?? 'initial',
      batchId: null,
      note: input.note ?? '',
      createdAt: isoToday(),
      createdBy: null,
    }
    this.data.ownershipAssignments.push(row)
    return row
  }

  async endOwnership(id: string, endDate: string) {
    const a = this.data.ownershipAssignments.find((x) => x.id === id)
    if (!a) return
    if (endDate <= a.startDate) {
      throw new Error('An assignment cannot end on or before it starts')
    }
    a.endDate = endDate
  }

  async transferBookOfBusiness(input: TransferBookOfBusinessInput) {
    if (!this.data.salesPersons.some((p) => p.id === input.fromSalesPersonId)) {
      throw new Error(`No such salesperson: ${input.fromSalesPersonId}`)
    }
    if (!this.data.salesPersons.some((p) => p.id === input.toSalesPersonId)) {
      throw new Error(`No such salesperson: ${input.toSalesPersonId}`)
    }
    if (input.toSalesPersonId === input.fromSalesPersonId) {
      throw new Error('Cannot transfer a book of business to the same person')
    }

    // Only currently-open owner rows that actually started before the
    // handoff — an assignment that starts on or after it can't be closed by
    // it without violating the half-open-interval invariant, so it's left
    // alone rather than silently failing the whole batch over one edge case.
    const open = this.data.ownershipAssignments.filter(
      (a) => a.salesPersonId === input.fromSalesPersonId && a.role === 'owner'
        && a.endDate === null && a.startDate < input.effectiveDate,
    )

    const batchId = uid('batch')
    const created: OwnershipAssignment[] = []
    for (const a of open) {
      a.endDate = input.effectiveDate
      const row: OwnershipAssignment = {
        id: uid('own'),
        entityType: a.entityType,
        entityId: a.entityId,
        salesPersonId: input.toSalesPersonId,
        role: 'owner',
        startDate: input.effectiveDate,
        endDate: null,
        reason: 'transfer',
        batchId,
        note: input.note ?? '',
        createdAt: isoToday(),
        createdBy: null,
      }
      this.data.ownershipAssignments.push(row)
      created.push(row)
    }
    return created
  }

  async listFollowUps(entityType: string, entityId: string) {
    return this.data.followUps
      .filter((f) => f.entityType === entityType && f.entityId === entityId)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  async listOpenFollowUps() {
    return this.data.followUps
      .filter((f) => f.status === 'open')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  async createFollowUp(input: CreateFollowUpInput) {
    const followUp: FollowUp = {
      id: uid('fup'),
      entityType: input.entityType,
      entityId: input.entityId,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate,
      status: 'open',
      note: input.note ?? '',
      createdAt: isoToday(),
      createdBy: null,
    }
    this.data.followUps.push(followUp)
    return followUp
  }

  async setFollowUpStatus(id: string, status: FollowUp['status']) {
    const f = this.data.followUps.find((x) => x.id === id)
    if (f) f.status = status
  }

  async deleteFollowUp(id: string) {
    this.data.followUps = this.data.followUps.filter((f) => f.id !== id)
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

  /** Everything `@goms/domain`'s `performSearch`/`performRelatedRecords` need,
   *  sourced from this store. Rebuilt per call rather than cached, same
   *  reasoning as `ownershipContext()` above. */
  private searchData(): SearchData {
    return {
      nodes: this.data.nodes,
      employees: this.data.employees.filter((e) => e.status === 'active'),
      transfers: this.data.transfers,
      timeline: this.data.timeline,
      opportunities: this.data.opportunities.map((o) => {
        const bid = this.data.bids.find((b) => b.opportunityId === o.id)
        return { ...o, bidId: bid?.id ?? null, bidCode: bid?.bidCode ?? null, tenderLink: bid?.tenderLink ?? null }
      }),
      salesPersons: this.data.salesPersons,
      postings: this.data.salesPostings,
      today: isoToday(),
    }
  }

  /** Natural-language-aware search. Recognises intent keywords ("connected",
   *  "vacant", "transferred", "follow-ups due"), a state scope by name, and
   *  relational phrases ("under X", "reporting to X"), then falls back to
   *  fuzzy matching over names/codes/designations/locations. See
   *  `@goms/domain`'s `performSearch` for the algorithm itself. */
  async search(query: string, stateCode?: number): Promise<SearchResult[]> {
    return performSearch(query, stateCode, this.searchData())
  }

  async relatedRecords(result: SearchResult): Promise<SearchResult[]> {
    return performRelatedRecords(result, this.searchData())
  }

  async moveTargets(nodeId: string) {
    const node = this.data.nodes.find((n) => n.id === nodeId)
    if (!node) return []
    const banned = new Set(this.subtreeIds(nodeId))
    return this.data.nodes.filter((c) => {
      if (banned.has(c.id)) return false
      if (c.domain !== node.domain || c.stateCode !== node.stateCode) return false
      if (c.status !== 'active') return false
      return isValidChildType(c.typeKey, node.typeKey)
    })
  }

  async importChildren(parentId: string, rows: ImportChildRow[]) {
    const parent = this.data.nodes.find((n) => n.id === parentId)
    if (!parent) return 0
    const validTypes = childTypesOf(parent.typeKey)
    const defaultType = NODE_TYPE_MAP[parent.typeKey]?.childKeys[0] ?? 'district'
    let added = 0
    for (const row of rows) {
      const trimmed = row.name.trim()
      if (!trimmed) continue
      const matched = row.type
        ? validTypes.find((t) => t.label.toLowerCase() === row.type!.trim().toLowerCase())
        : undefined
      await this.createNode({
        domain: parent.domain, typeKey: matched?.key ?? defaultType, parentId,
        stateCode: parent.stateCode, name: trimmed,
      })
      added += 1
    }
    return added
  }

  /** Bulk-creates employees under an existing org node — the employee
   *  counterpart to `importChildren` above. Rows missing a name or
   *  designation (both required on `Employee`) are skipped rather than
   *  creating a half-filled record. */
  async importEmployees(orgNodeId: string, rows: ImportEmployeeRow[]) {
    const node = this.data.nodes.find((n) => n.id === orgNodeId)
    if (!node) return 0
    let added = 0
    for (const row of rows) {
      const name = row.name.trim()
      const designation = row.designation.trim()
      if (!name || !designation) continue
      await this.createEmployee({
        name, designation,
        email: row.email?.trim() ?? '',
        phone: row.phone?.trim() ?? '',
        orgNodeId, managerId: null,
        connected: row.connected,
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

    const upcomingMeetings: InteractionSummary[] = this.data.timeline
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
      transfers: this.data.transfers.length,
      highPriority: people.filter((e) => e.importantContact).length,
      qualityDist, statusDist, recentInteractions, upcomingMeetings,
    }
  }

  // --- Customers ---------------------------------------------------------
  async listCustomers(): Promise<Customer[]> {
    return [...this.data.customers].sort((a, b) => a.name.localeCompare(b.name))
  }
  async getCustomer(id: string): Promise<Customer | null> {
    return this.data.customers.find((c) => c.id === id) ?? null
  }
  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const customer: Customer = {
      id: uid('cust'), name: input.name, organization: input.organization ?? '', address: input.address ?? '',
      gst: input.gst ?? '', contactName: input.contactName ?? '', contactEmail: input.contactEmail ?? '',
      contactPhone: input.contactPhone ?? '', notes: input.notes ?? '', createdAt: isoToday(), updatedAt: isoToday(),
    }
    this.data.customers.push(customer)
    return customer
  }
  async updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer> {
    const customer = this.data.customers.find((c) => c.id === id)!
    Object.assign(customer, patch, { updatedAt: isoToday() })
    return customer
  }
  async deleteCustomer(id: string): Promise<void> {
    this.data.customers = this.data.customers.filter((c) => c.id !== id)
  }
}

/** Every `Repository` method that changes stored data. The proxy below saves a
 *  snapshot after each of these resolves, so a new mutating method MUST be
 *  listed here or its effects won't survive a reload. */
const MUTATOR_KEYS = [
  'createNode', 'updateNode', 'setNodeStatus', 'deleteNode', 'moveNode', 'duplicateNode',
  'reorderNode', 'importChildren', 'importEmployees',
  'createEmployee', 'updateEmployee', 'setManager', 'deleteEmployee', 'mergeEmployees',
  'addTimelineEvent', 'updateTimelineEvent', 'setTimelineEventAttended', 'deleteTimelineEvent',
  'transferEmployee', 'addCharge', 'removeCharge',
  'createOpportunity', 'updateOpportunity', 'deleteOpportunity',
  'createFollowUp', 'setFollowUpStatus', 'deleteFollowUp',
  'assignOwner', 'endOwnership', 'transferBookOfBusiness',
  'createSalesPerson', 'updateSalesPerson', 'setSalesPersonStatus', 'deleteSalesPerson', 'transferSalesPerson', 'updatePostingManager', 'updatePostingDates',
  'createMaster', 'updateMaster', 'setMasterActive', 'deleteMaster', 'setEditionFeatures',
  'createSku', 'updateSku', 'deleteSku', 'createBomItem', 'updateBomItem', 'deleteBomItem',
  'createBoq', 'updateBoq', 'addBoqLineItem', 'updateBoqLineItem', 'removeBoqLineItem', 'reorderBoqLineItems', 'updateBoqStatus', 'reviseBoq', 'duplicateBoq', 'deleteBoq',
  'createCustomer', 'updateCustomer', 'deleteCustomer',
  'createBid', 'updateBid', 'archiveBid', 'markBidVerified', 'unarchiveBid', 'deleteBid',
  'createBidMilestone', 'updateBidMilestone', 'deleteBidMilestone',
  'createBidCorrigendum', 'reviewCorrigendumChange', 'freezeValue', 'unfreezeValue',
  'requestDocumentUploadUrl', 'confirmDocumentUpload', 'deleteDocument', 'createDocumentCitation', 'deleteDocumentCitation',
  'createBidSavedView', 'updateBidSavedView', 'deleteBidSavedView',
  'createBidCustomField', 'updateBidCustomField', 'reorderBidCustomFields', 'archiveBidCustomField',
  'unarchiveBidCustomField', 'deleteBidCustomField', 'setBidCustomValue',
] as const

/** Read-only methods. Listed only so the exhaustiveness check below can tell
 *  "classified as a read" apart from "nobody classified it". */
const READER_KEYS = [
  'listStates', 'getState', 'getNode', 'listChildren', 'listOrgRoots', 'listDepartments', 'listPostingNodes',
  'breadcrumb', 'childCount', 'geoRoot', 'childCounts',
  'listEmployeesUnder', 'listEmployeesDirect', 'listEmployeesByState', 'listAllEmployees',
  'listEmployeeDepartments', 'getEmployee', 'directReports', 'reportingChain',
  'listTimeline', 'listAllTimelineEvents', 'listTransfers', 'listMergeAudit',
  'listOpportunities', 'listOpportunitiesByDepartment', 'getOpportunity', 'listOpportunityStageChanges',
  'listFollowUps', 'listOpenFollowUps',
  'listSalesPersons', 'getSalesPerson', 'listSalesPostings', 'currentPostings',
  'listOwnershipAssignments', 'listOwnershipFor', 'listOwnedBy', 'resolveOwner', 'resolveOwners',
  'search', 'relatedRecords', 'moveTargets', 'relationshipAnalytics',
  'listMaster', 'getMaster', 'listEditionFeatures',
  'listSkus', 'getSku', 'listBomItemsForSku', 'listAllBomItems', 'listBoqs', 'getBoq', 'listBoqLineItems',
  'listAllBoqLineItems', 'listAuditLogs',
  'listCustomers', 'getCustomer',
  'listBidsForGrid', 'getBid', 'getBidForOpportunity', 'listBidActionQueue', 'listBidMilestones', 'listAllBidMilestones', 'listBidCorrigenda', 'listProtectedValues',
  'listDocuments', 'listDocumentCitations', 'getDocumentDownloadUrl', 'listBidSavedViews', 'listBidCustomFields', 'listBidCustomValues',
] as const

// Adding a method to `Repository` without classifying it above breaks the
// build here, rather than silently not persisting at runtime: `Unclassified`
// stops being `never`, so it no longer satisfies the constraint.
type Unclassified = Exclude<keyof Repository, (typeof MUTATOR_KEYS | typeof READER_KEYS)[number]>
const _allMethodsClassified: [Unclassified] extends [never] ? true : Unclassified = true
void _allMethodsClassified

const MUTATORS: ReadonlySet<keyof Repository> = new Set(MUTATOR_KEYS)

const impl = new InMemoryRepository()

/** Hydrates the store from the locally persisted snapshot, if there is one.
 *  Call once, before the first render (see main.tsx) — every read goes straight
 *  at `this.data`, so swapping it in afterwards would race the first queries. */
export async function bootstrapRepository(): Promise<void> {
  const saved = await loadSnapshot()
  if (saved) impl.hydrate(saved)
}

/** Discards the local snapshot and returns the store to pure seed data. */
export async function resetLocalData(): Promise<void> {
  await clearSnapshot()
  impl.hydrate(buildSeed())
}

/** The full store, serializable as-is for a JSON backup — see
 *  src/data/backup.ts. Not part of `Repository`: read-only introspection of
 *  the whole store, not a per-entity domain operation. */
export function getFullSnapshot(): GormsData {
  return impl.snapshot()
}

/** Replaces the whole store with a restored backup and persists it, the
 *  same way any other mutation would — but bypassing the `Repository` proxy
 *  since this isn't a per-entity domain operation either. Callers must
 *  invalidate their own query cache afterward; this module has no
 *  dependency on React Query. */
export function restoreFromBackup(data: GormsData): void {
  impl.hydrate(data)
  scheduleSave(() => impl.snapshot())
}

/** The store, wrapped so that every mutation schedules a save. A proxy rather
 *  than a `persist()` call at the end of ~18 methods: one place to get right,
 *  and impossible to forget in a method body. Methods are bound to the concrete
 *  instance so their private-field access still works. */
export const repository: Repository = new Proxy(impl, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver)
    if (typeof value !== 'function') return value
    const key = prop as keyof Repository
    if (!MUTATORS.has(key)) return (value as (...a: unknown[]) => unknown).bind(target)
    return (...args: unknown[]) => {
      const out = (value as (...a: unknown[]) => unknown).apply(target, args)
      // Save only once the mutation has actually resolved, so a rejected call
      // (e.g. a validation throw) doesn't persist a half-applied state.
      return Promise.resolve(out).then((result) => {
        scheduleSave(() => target.snapshot())
        return result
      })
    }
  },
}) as Repository

// `impl` is a module-level singleton hydrated exactly once, at startup,
// before `main.tsx`'s first render (see bootstrapRepository above). Without
// this, Vite can re-execute this module in place when it (or something it
// imports) changes during a dev session — re-running
// `const impl = new InMemoryRepository()` with fresh, unhydrated seed data,
// while the mounted React tree survives via Fast Refresh and keeps rendering
// through it. The user sees their data "disappear," and the very next
// mutation schedules a save of that empty seed state, overwriting the real
// IndexedDB snapshot for good. Accepting the update and immediately
// `invalidate()`-ing it is Vite's documented way to say "this module can
// never be hot-swapped in place" — it forces the update to propagate into a
// full page reload instead, which correctly re-runs `bootstrapRepository()`
// before anything renders. This only affects local dev (`import.meta.hot` is
// undefined in production builds and in the Vitest environment, so it's a
// no-op there).
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate('src/data/in-memory/repository.ts holds a hydrated singleton and cannot be hot-swapped safely')
  })
}

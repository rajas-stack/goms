import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DepartmentChoice, NewBidOpportunity } from '@goms/domain'
import {
  repository, type AddTimelineInput, type AssignOwnerInput, type CreateEmployeeInput, type CreateFollowUpInput,
  type CreateNodeInput, type CreateOpportunityInput, type CreateSalesPersonInput, type CreateDeliveryTeamMemberInput, type UpdateDeliveryTeamMemberPatch, type ImportChildRow,
  type ImportEmployeeRow, type MergeEmployeesInput, type TransferBookOfBusinessInput, type TransferInput,
  type TransferSalesPersonInput,
} from '@/data/repository'
import type {
  Bid, BidMilestone, BidSavedView, Charge, DeliveryTeamKey, DeliveryTeamMember, Employee, FollowUp, HierNode, Opportunity, SalesPerson, SearchResult, Status,
  TimelineEvent, TimelineEventType,
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
  bidsForGrid: (filterRules?: unknown) => ['bidsForGrid', filterRules ?? null] as const,
  bid: (id: string) => ['bid', id] as const,
  bidMilestones: (bidId: string) => ['bidMilestones', bidId] as const,
  bidCorrigenda: (bidId: string) => ['bidCorrigenda', bidId] as const,
  protectedValues: (t: string, id: string) => ['protectedValues', t, id] as const,
  documents: (t: string, id: string) => ['documents', t, id] as const,
  bidSavedViews: ['bidSavedViews'] as const,
  bidActionQueue: ['bidActionQueue'] as const,
  bidCustomFields: (includeArchived?: boolean) => ['bidCustomFields', includeArchived ?? false] as const,
  bidCustomValues: (bidId: string) => ['bidCustomValues', bidId] as const,
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
    // The Bid Tracker Master Grid rows are joined from opportunity fields.
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
  }
  const create = useMutation({ mutationFn: (i: CreateOpportunityInput) => repository.createOpportunity(i), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Opportunity> }) => repository.updateOpportunity(a.id, a.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteOpportunity(id), onSuccess: invalidate })
  return { create, update, remove }
}

// --- Bid Tracker ---
export const useBidsForGrid = (filterRules?: BidSavedView['filterRules']) =>
  // keepPreviousData: changing a filter must not blank the grid to a loading
  // state while the new rows load — the old rows stay until the new ones land.
  useQuery({
    queryKey: qk.bidsForGrid(filterRules), queryFn: () => repository.listBidsForGrid(filterRules),
    placeholderData: keepPreviousData,
  })
export const useBid = (id: string | null) =>
  useQuery({ queryKey: qk.bid(id ?? ''), queryFn: async () => (await repository.getBid(id!)) ?? null, enabled: !!id })
export function useBidMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
    qc.invalidateQueries({ queryKey: ['bidMilestones', 'all'] })
    qc.invalidateQueries({ queryKey: ['bid'] })
    qc.invalidateQueries({ queryKey: ['bidForOpportunity'] })
    qc.invalidateQueries({ queryKey: ['bidActionQueue'] })
    // A bid's stage/decision syncs back to its opportunity (spec §4.4).
    qc.invalidateQueries({ queryKey: ['opportunities'] })
    qc.invalidateQueries({ queryKey: ['opportunity'] })
    qc.invalidateQueries({ queryKey: ['opportunityStageChanges'] })
  }
  // Both entry points (the Bid Tracker's Create Bid dialog and the opportunity card) go through
  // this one mutation; `department` is only sent when the opportunity has none.
  const create = useMutation({
    mutationFn: (a: { opportunityId: string; department?: DepartmentChoice }) => repository.createBid(a.opportunityId, a.department),
    onSuccess: invalidate,
  })
  // Create the opportunity, its department and the bid in one go (Bid Tracker's Create Bid → new opportunity).
  const createWithNewOpportunity = useMutation({
    mutationFn: (a: { opportunity: NewBidOpportunity; department: DepartmentChoice }) => repository.createBidForNewOpportunity(a.opportunity, a.department),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['opportunities'] }); qc.invalidateQueries({ queryKey: ['departments'] }) },
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Pick<Bid, 'stageKey' | 'decision' | 'tenderLink'>> }) =>
      repository.updateBid(a.id, a.patch),
    onSuccess: invalidate,
  })
  const archive = useMutation({ mutationFn: (id: string) => repository.archiveBid(id), onSuccess: invalidate })
  const unarchive = useMutation({ mutationFn: (id: string) => repository.unarchiveBid(id), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteBid(id), onSuccess: invalidate })
  const markVerified = useMutation({ mutationFn: (id: string) => repository.markBidVerified(id), onSuccess: invalidate })
  return { create, createWithNewOpportunity, update, archive, unarchive, remove, markVerified }
}
export const useBidForOpportunity = (opportunityId: string | null) =>
  useQuery({
    queryKey: ['bidForOpportunity', opportunityId ?? ''],
    queryFn: async () => (await repository.getBidForOpportunity(opportunityId!)) ?? null,
    enabled: !!opportunityId,
  })
export const useBidActionQueue = () =>
  useQuery({ queryKey: qk.bidActionQueue, queryFn: () => repository.listBidActionQueue() })

export const useBidMilestones = (bidId: string | null) =>
  useQuery({ queryKey: qk.bidMilestones(bidId ?? ''), queryFn: () => repository.listBidMilestones(bidId!), enabled: !!bidId })
export const useAllBidMilestones = () =>
  useQuery({ queryKey: ['bidMilestones', 'all'], queryFn: () => repository.listAllBidMilestones() })
export function useBidMilestoneMutations(bidId: string) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.bidMilestones(bidId) })
    qc.invalidateQueries({ queryKey: ['bidMilestones', 'all'] })
    qc.invalidateQueries({ queryKey: ['bid', bidId] })
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
  }
  const create = useMutation({
    mutationFn: (input: Parameters<typeof repository.createBidMilestone>[0]) => repository.createBidMilestone(input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Pick<BidMilestone, 'label' | 'dueAt' | 'venue' | 'notes' | 'status'>> }) =>
      repository.updateBidMilestone(a.id, a.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteBidMilestone(id), onSuccess: invalidate })
  return { create, update, remove }
}

export const useBidCorrigenda = (bidId: string | null) =>
  useQuery({ queryKey: qk.bidCorrigenda(bidId ?? ''), queryFn: () => repository.listBidCorrigenda(bidId!), enabled: !!bidId })
/** corrigendum id → bid id for the given bids (their corrigenda load through the same
 *  cache as each bid's own page). Lets the Activity History link a corrigendum
 *  audit row, which is keyed to the corrigendum, back to its bid. */
export function useCorrigendumBidMap(bidIds: string[]): Map<string, string> {
  const results = useQueries({
    queries: bidIds.map((id) => ({ queryKey: qk.bidCorrigenda(id), queryFn: () => repository.listBidCorrigenda(id) })),
  })
  const map = new Map<string, string>()
  results.forEach((r, i) => { for (const c of r.data ?? []) map.set(c.id, bidIds[i]) })
  return map
}
export function useBidCorrigendaMutations(bidId: string) {
  const qc = useQueryClient()
  // Reviewing a change can move a milestone, the bid's tender link/confidence,
  // and the opportunity's submission date, so all of those go stale together.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.bidCorrigenda(bidId) })
    qc.invalidateQueries({ queryKey: qk.bidMilestones(bidId) })
    qc.invalidateQueries({ queryKey: ['bidMilestones', 'all'] })
    qc.invalidateQueries({ queryKey: ['bid', bidId] })
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
    qc.invalidateQueries({ queryKey: ['opportunity'] })
  }
  const create = useMutation({
    mutationFn: (input: Parameters<typeof repository.createBidCorrigendum>[0]) => repository.createBidCorrigendum(input),
    onSuccess: invalidate,
  })
  const reviewChange = useMutation({
    mutationFn: (input: Parameters<typeof repository.reviewCorrigendumChange>[0]) => repository.reviewCorrigendumChange(input),
    onSuccess: invalidate,
  })
  return { create, reviewChange }
}

export const useProtectedValues = (entityType: string, entityId: string | null) =>
  useQuery({
    queryKey: qk.protectedValues(entityType, entityId ?? ''),
    queryFn: () => repository.listProtectedValues(entityType, entityId!),
    enabled: !!entityId,
  })
export function useProtectedValueMutations(entityType: string, entityId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.protectedValues(entityType, entityId) })
  const freeze = useMutation({ mutationFn: (fieldKey: string) => repository.freezeValue(entityType, entityId, fieldKey), onSuccess: invalidate })
  const unfreeze = useMutation({
    mutationFn: (a: { fieldKey: string; reason: string }) => repository.unfreezeValue(entityType, entityId, a.fieldKey, a.reason),
    onSuccess: invalidate,
  })
  return { freeze, unfreeze }
}

export const useDocuments = (entityType: string, entityId: string | null) =>
  useQuery({
    queryKey: qk.documents(entityType, entityId ?? ''),
    queryFn: () => repository.listDocuments(entityType, entityId!),
    enabled: !!entityId,
  })
export function useDocumentMutations(entityType: string, entityId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.documents(entityType, entityId) })
  const requestUploadUrl = useMutation({
    mutationFn: (input: Parameters<typeof repository.requestDocumentUploadUrl>[0]) => repository.requestDocumentUploadUrl(input),
  })
  const confirmUpload = useMutation({ mutationFn: (uploadId: string) => repository.confirmDocumentUpload(uploadId), onSuccess: invalidate })
  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteDocument(id),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['bidsForGrid'] }) },
  })
  /** Mints a fresh signed URL on each call (a cached one would expire). */
  const download = useMutation({ mutationFn: (id: string) => repository.getDocumentDownloadUrl(id) })
  return { requestUploadUrl, confirmUpload, remove, download }
}

export const useDocumentCitations = (documentId: string | null) =>
  useQuery({
    queryKey: ['documentCitations', documentId ?? ''],
    queryFn: () => repository.listDocumentCitations(documentId!),
    enabled: !!documentId,
  })
export function useDocumentCitationMutations(documentId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['documentCitations', documentId] })
  const create = useMutation({
    mutationFn: (input: { pageLabel: string; quoteText?: string }) => repository.createDocumentCitation({ documentId, ...input }),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteDocumentCitation(id), onSuccess: invalidate })
  return { create, remove }
}

/** Saved views for one Opportunity sheet: the system views (on every sheet) plus that sheet's own. */
export const useBidSavedViews = (sheet = 'bidTracker') =>
  useQuery({
    queryKey: qk.bidSavedViews, queryFn: () => repository.listBidSavedViews(),
    select: (views) => views.filter((v) => v.isSystem || (v.sheet ?? 'bidTracker') === sheet),
  })
export function useBidSavedViewMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.bidSavedViews })
  const create = useMutation({
    mutationFn: (input: Parameters<typeof repository.createBidSavedView>[0]) => repository.createBidSavedView(input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Pick<BidSavedView, 'name' | 'filterRules' | 'sort' | 'visibleColumns'>> }) =>
      repository.updateBidSavedView(a.id, a.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteBidSavedView(id), onSuccess: invalidate })
  return { create, update, remove }
}

// --- Bid Tracker: custom columns (spec §8.1) ---
export const useBidCustomFields = (includeArchived = false) =>
  useQuery({ queryKey: qk.bidCustomFields(includeArchived), queryFn: () => repository.listBidCustomFields(includeArchived) })
export const useBidCustomValues = (bidId: string | null) =>
  useQuery({ queryKey: qk.bidCustomValues(bidId ?? ''), queryFn: () => repository.listBidCustomValues(bidId!), enabled: !!bidId })
export function useBidCustomFieldMutations() {
  const qc = useQueryClient()
  // Any definition change (rename, options, order, archive) changes what the
  // grid shows and how saved views resolve, so the grid refetches too.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bidCustomFields'] })
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
    qc.invalidateQueries({ queryKey: ['bidCustomValues'] })
  }
  const create = useMutation({
    mutationFn: (input: Parameters<typeof repository.createBidCustomField>[0]) => repository.createBidCustomField(input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: { name?: string; options?: string[] } }) => repository.updateBidCustomField(a.id, a.patch),
    onSuccess: invalidate,
  })
  const reorder = useMutation({ mutationFn: (ids: string[]) => repository.reorderBidCustomFields(ids), onSuccess: invalidate })
  const archive = useMutation({ mutationFn: (id: string) => repository.archiveBidCustomField(id), onSuccess: invalidate })
  const unarchive = useMutation({ mutationFn: (id: string) => repository.unarchiveBidCustomField(id), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (a: { id: string; withValues?: boolean }) => repository.deleteBidCustomField(a.id, a.withValues), onSuccess: invalidate })
  return { create, update, reorder, archive, unarchive, remove }
}
/** Sets/clears one custom cell. The grid layers optimistic updates on top in
 *  Task 28; this hook only invalidates on success. */
export function useSetBidCustomValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: { bidId: string; fieldId: string; value: string | number | boolean | null }) =>
      repository.setBidCustomValue(a.bidId, a.fieldId, a.value),
    onSuccess: (_result, a) => {
      qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
      qc.invalidateQueries({ queryKey: qk.bidCustomValues(a.bidId) })
      qc.invalidateQueries({ queryKey: ['bid', a.bidId] })
    },
  })
}

export const useSalesPersons = () =>
  useQuery({ queryKey: qk.salesPersons, queryFn: () => repository.listSalesPersons() })
export const useDeliveryTeamMembers = (team?: DeliveryTeamKey) =>
  useQuery({ queryKey: ['deliveryTeamMembers', team ?? 'all'], queryFn: () => repository.listDeliveryTeamMembers(team) })

export function useDeliveryTeamMemberMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['deliveryTeamMembers'] })
    qc.invalidateQueries({ queryKey: ['opportunities'] })
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
  }
  const create = useMutation({ mutationFn: (input: CreateDeliveryTeamMemberInput) => repository.createDeliveryTeamMember(input), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (input: { id: string; patch: UpdateDeliveryTeamMemberPatch }) => repository.updateDeliveryTeamMember(input.id, input.patch),
    onSuccess: invalidate,
  })
  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: DeliveryTeamMember['status'] }) => repository.setDeliveryTeamMemberStatus(input.id, input.status),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => repository.deleteDeliveryTeamMember(id), onSuccess: invalidate })
  return { create, update, setStatus, remove }
}
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
  const updatePostingDates = useMutation({
    mutationFn: (a: { postingId: string; startDate?: string; lastDayHeld?: string | null }) => {
      const { postingId, ...edit } = a
      return repository.updatePostingDates(postingId, edit)
    },
    onSuccess: invalidate,
  })
  return { create, update, setStatus, remove, transfer, updatePostingManager, updatePostingDates }
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
    // The Bid Tracker grid's Bid Owner / Sales Lead columns resolve ownership server-side.
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
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
    // A bid's Next Action feeds the Master Grid's action columns and the Action Queue.
    qc.invalidateQueries({ queryKey: ['bidsForGrid'] })
    qc.invalidateQueries({ queryKey: ['bidActionQueue'] })
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

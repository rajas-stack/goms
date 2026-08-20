import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { repository } from '@/data/repository'
import { isBoqPendingApproval } from './repository-logic'
import type {
  BoqStatus, CommercialBoqLineItem, CommercialSku, CreateBoqInput, CreateBoqLineItemInput, CreateBomItemInput,
  CreateMasterInput, CreateSkuInput, MasterEntityKey, MasterRowMap, UpdateBoqInput,
} from './types'

const qk = {
  masters: (key: MasterEntityKey) => ['commercialCalculator', 'masters', key] as const,
  master: (key: MasterEntityKey, id: string) => ['commercialCalculator', 'master', key, id] as const,
  editionFeatures: (editionId: string) => ['commercialCalculator', 'editionFeatures', editionId] as const,
  skus: ['commercialCalculator', 'skus'] as const,
  bomItems: (parentSkuId: string) => ['commercialCalculator', 'bomItems', parentSkuId] as const,
  allBomItems: ['commercialCalculator', 'bomItems', 'all'] as const,
  boqs: ['commercialCalculator', 'boqs'] as const,
  boqLineItems: (boqId: string) => ['commercialCalculator', 'boqLineItems', boqId] as const,
  allBoqLineItems: ['commercialCalculator', 'boqLineItems', 'all'] as const,
  dashboardMetrics: ['commercialCalculator', 'dashboardMetrics'] as const,
  auditLogs: (entityType?: string, entityId?: string) =>
    ['commercialCalculator', 'auditLogs', entityType ?? 'all', entityId ?? 'all'] as const,
}

// --- Generic Masters CRUD (Phase 0/1) --------------------------------------

export const useMasters = <K extends MasterEntityKey>(key: K) =>
  useQuery({ queryKey: qk.masters(key), queryFn: () => repository.listMaster(key) })

export function useMasterMutations<K extends MasterEntityKey>(key: K) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.masters(key) })
    qc.invalidateQueries({ queryKey: ['commercialCalculator', 'master', key] })
  }
  const create = useMutation({
    mutationFn: (input: CreateMasterInput<K>) => repository.createMaster(key, input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<MasterRowMap[K]>; changeReason?: string }) =>
      repository.updateMaster(key, a.id, a.patch, a.changeReason),
    onSuccess: invalidate,
  })
  const setActive = useMutation({
    mutationFn: (a: { id: string; active: boolean }) => repository.setMasterActive(key, a.id, a.active),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteMaster(key, id),
    onSuccess: invalidate,
  })
  return { create, update, setActive, remove }
}

// --- Product Edition <-> Feature mapping (spec §6.2) -----------------------

export const useEditionFeatures = (editionId: string) =>
  useQuery({ queryKey: qk.editionFeatures(editionId), queryFn: () => repository.listEditionFeatures(editionId) })

export function useSetEditionFeatures() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: { editionId: string; mappings: { featureId: string; mandatory: boolean }[] }) =>
      repository.setEditionFeatures(a.editionId, a.mappings),
    onSuccess: (_data, a) => qc.invalidateQueries({ queryKey: qk.editionFeatures(a.editionId) }),
  })
}

// --- SKU Catalog (spec §6.3/§7/§14) ----------------------------------------

export const useSkus = () => useQuery({ queryKey: qk.skus, queryFn: () => repository.listSkus() })

export function useSkuMutations() {
  const qc = useQueryClient()
  // A SKU's price/cost fields feed every BOQ that references it (draft BOQs
  // recompute live off the SKU; margin always does) — so a SKU edit must
  // invalidate BOQ-shaped queries too, not just the SKU list itself.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.skus })
    qc.invalidateQueries({ queryKey: qk.auditLogs() })
    qc.invalidateQueries({ queryKey: qk.boqs })
    qc.invalidateQueries({ queryKey: ['commercialCalculator', 'boqLineItems'] })
    qc.invalidateQueries({ queryKey: qk.dashboardMetrics })
  }
  const create = useMutation({
    mutationFn: (input: CreateSkuInput) => repository.createSku(input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<CommercialSku>; changeReason?: string }) =>
      repository.updateSku(a.id, a.patch, a.changeReason),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteSku(id),
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

// --- Commercial BOM (spec §6.4/§14) -----------------------------------------

export const useBomItems = (parentSkuId: string | null) =>
  useQuery({
    queryKey: qk.bomItems(parentSkuId ?? ''),
    queryFn: () => repository.listBomItemsForSku(parentSkuId!),
    enabled: !!parentSkuId,
  })

/** Every BOM item across every parent SKU — powers the SKU Catalog's "Usage
 *  Count" column (how many other SKUs reference this one as a component). */
export const useAllBomItems = () => useQuery({ queryKey: qk.allBomItems, queryFn: () => repository.listAllBomItems() })

export function useBomMutations(parentSkuId: string) {
  const qc = useQueryClient()
  // A mandatory BOM link changes the parent SKU's fully-loaded cost, which
  // feeds every BOQ margin figure — same reasoning as useSkuMutations above.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.bomItems(parentSkuId) })
    qc.invalidateQueries({ queryKey: qk.allBomItems })
    qc.invalidateQueries({ queryKey: qk.boqs })
    qc.invalidateQueries({ queryKey: ['commercialCalculator', 'boqLineItems'] })
    qc.invalidateQueries({ queryKey: qk.dashboardMetrics })
  }
  const add = useMutation({
    mutationFn: (input: CreateBomItemInput) => repository.createBomItem(input),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteBomItem(id),
    onSuccess: invalidate,
  })
  return { add, remove }
}

// --- BOQ (spec §6.5/§9/§10/§12/§13) -----------------------------------------

export const useBoqs = () => useQuery({ queryKey: qk.boqs, queryFn: () => repository.listBoqs() })

export const useBoqLineItems = (boqId: string) =>
  useQuery({ queryKey: qk.boqLineItems(boqId), queryFn: () => repository.listBoqLineItems(boqId), enabled: !!boqId })

/** Every BOQ line item across every BOQ — powers the SKU Catalog's "BOQ
 *  Count" column (how many proposals reference this SKU). */
export const useAllBoqLineItems = () =>
  useQuery({ queryKey: qk.allBoqLineItems, queryFn: () => repository.listAllBoqLineItems() })

export function useBoqMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.boqs })
    qc.invalidateQueries({ queryKey: ['commercialCalculator', 'boqLineItems'] })
    qc.invalidateQueries({ queryKey: qk.dashboardMetrics })
    qc.invalidateQueries({ queryKey: qk.auditLogs() })
  }
  const create = useMutation({
    mutationFn: async (a: { input: CreateBoqInput; lines: CreateBoqLineItemInput[] }) => {
      const boq = await repository.createBoq(a.input)
      for (const line of a.lines) await repository.addBoqLineItem(boq.id, line)
      return { boq }
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: UpdateBoqInput }) => repository.updateBoq(a.id, a.patch),
    onSuccess: invalidate,
  })
  const updateStatus = useMutation({
    mutationFn: (a: { id: string; nextStatus: BoqStatus; changeReason: string }) =>
      repository.updateBoqStatus(a.id, a.nextStatus, a.changeReason),
    onSuccess: invalidate,
  })
  const revise = useMutation({
    mutationFn: (id: string) => repository.reviseBoq(id),
    onSuccess: invalidate,
  })
  const duplicate = useMutation({
    mutationFn: (id: string) => repository.duplicateBoq(id),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteBoq(id),
    onSuccess: invalidate,
  })
  return { create, update, updateStatus, revise, duplicate, remove }
}

export function useBoqLineItemMutations(boqId: string) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.boqLineItems(boqId) })
    qc.invalidateQueries({ queryKey: qk.boqs })
    qc.invalidateQueries({ queryKey: qk.dashboardMetrics })
  }
  const add = useMutation({
    mutationFn: (input: CreateBoqLineItemInput) => repository.addBoqLineItem(boqId, input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Pick<CommercialBoqLineItem,
      'quantity' | 'unitPrice' | 'discountPct' | 'approverId' | 'approvalDate' | 'approvalRemarks' | 'approvalStatus'
      | 'pricingLevels' | 'activePricingLevel'
    >> }) => repository.updateBoqLineItem(a.id, a.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => repository.removeBoqLineItem(id),
    onSuccess: invalidate,
  })
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => repository.reorderBoqLineItems(boqId, orderedIds),
    onSuccess: invalidate,
  })
  return { add, update, remove, reorder }
}

// --- Dashboard (spec §11) ----------------------------------------------------

export interface DashboardMetrics {
  draft: number
  pendingApproval: number
  approved: number
  rejected: number
}

export const useDashboardMetrics = () =>
  useQuery({
    queryKey: qk.dashboardMetrics,
    queryFn: async (): Promise<DashboardMetrics> => {
      const boqs = await repository.listBoqs()
      return {
        draft: boqs.filter((b) => b.status === 'draft').length,
        pendingApproval: boqs.filter((b) => isBoqPendingApproval(b.status)).length,
        approved: boqs.filter((b) => b.status === 'approved').length,
        rejected: boqs.filter((b) => b.status === 'rejected').length,
      }
    },
  })

// --- Audit Log (spec §6.6/§15) ----------------------------------------------

export const useAuditLogs = (filter?: { entityType?: string; entityId?: string }) =>
  useQuery({
    queryKey: qk.auditLogs(filter?.entityType, filter?.entityId),
    queryFn: () => repository.listAuditLogs(filter?.entityType || filter?.entityId ? filter : undefined),
  })

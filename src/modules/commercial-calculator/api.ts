import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { repository } from '@/data/repository'
import { computeBoqMarginPercent, isBoqPendingApproval } from './repository-logic'
import type {
  BoqStatus, CommercialBoqLineItem, CommercialSku, CreateBoqInput, CreateBoqLineItemInput, CreateBomItemInput,
  CreateMasterInput, CreateSkuInput, MasterEntityKey, MasterRowMap,
} from './types'

export const qk = {
  masters: (key: MasterEntityKey) => ['commercialCalculator', 'masters', key] as const,
  master: (key: MasterEntityKey, id: string) => ['commercialCalculator', 'master', key, id] as const,
  editionFeatures: (editionId: string) => ['commercialCalculator', 'editionFeatures', editionId] as const,
  skus: ['commercialCalculator', 'skus'] as const,
  bomItems: (parentSkuId: string) => ['commercialCalculator', 'bomItems', parentSkuId] as const,
  boqs: ['commercialCalculator', 'boqs'] as const,
  boqLineItems: (boqId: string) => ['commercialCalculator', 'boqLineItems', boqId] as const,
  dashboardMetrics: ['commercialCalculator', 'dashboardMetrics'] as const,
  auditLogs: (entityType?: string) => ['commercialCalculator', 'auditLogs', entityType ?? 'all'] as const,
}

// --- Generic Masters CRUD (Phase 0/1) --------------------------------------

export const useMasters = <K extends MasterEntityKey>(key: K) =>
  useQuery({ queryKey: qk.masters(key), queryFn: () => repository.listMaster(key) })

export const useMaster = <K extends MasterEntityKey>(key: K, id: string | null) =>
  useQuery({
    queryKey: qk.master(key, id ?? ''),
    queryFn: () => repository.getMaster(key, id!),
    enabled: !!id,
  })

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
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.skus })
    qc.invalidateQueries({ queryKey: qk.auditLogs() })
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

export function useBomMutations(parentSkuId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.bomItems(parentSkuId) })
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
  const updateStatus = useMutation({
    mutationFn: (a: { id: string; nextStatus: BoqStatus; changeReason: string }) =>
      repository.updateBoqStatus(a.id, a.nextStatus, a.changeReason),
    onSuccess: invalidate,
  })
  const revise = useMutation({
    mutationFn: (id: string) => repository.reviseBoq(id),
    onSuccess: invalidate,
  })
  return { create, updateStatus, revise }
}

export function useBoqLineItemMutations(boqId: string) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.boqLineItems(boqId) })
    qc.invalidateQueries({ queryKey: qk.boqs })
    qc.invalidateQueries({ queryKey: qk.dashboardMetrics })
  }
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<Pick<CommercialBoqLineItem, 'quantity' | 'unitPrice' | 'discountPct' | 'approverName' | 'approvalDate' | 'approvalRemarks' | 'approvalStatus'>> }) =>
      repository.updateBoqLineItem(a.id, a.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => repository.removeBoqLineItem(id),
    onSuccess: invalidate,
  })
  return { update, remove }
}

// --- Dashboard (spec §11) ----------------------------------------------------

export interface DashboardMetrics {
  draft: number
  pendingApproval: number
  approved: number
  rejected: number
  totalCommercialValue: number
  averageMargin: number
}

/** Spec §11: "active pipeline" for Total Commercial Value / Average Margin
 *  is every BOQ NOT in one of these four terminal-or-not-yet-real statuses. */
const EXCLUDED_FROM_ACTIVE_PIPELINE: BoqStatus[] = ['draft', 'cancelled', 'rejected', 'archived']

export const useDashboardMetrics = () =>
  useQuery({
    queryKey: qk.dashboardMetrics,
    queryFn: async (): Promise<DashboardMetrics> => {
      const [boqs, skus] = await Promise.all([repository.listBoqs(), repository.listSkus()])
      const skusById = new Map(skus.map((s) => [s.id, s]))
      const activePipeline = boqs.filter((b) => !EXCLUDED_FROM_ACTIVE_PIPELINE.includes(b.status))
      const totalCommercialValue = activePipeline.reduce((sum, b) => sum + b.grandTotal, 0)
      const margins = await Promise.all(activePipeline.map(async (b) => {
        const lines = await repository.listBoqLineItems(b.id)
        return computeBoqMarginPercent(b, lines, skusById)
      }))
      const averageMargin = margins.length === 0 ? 0 : margins.reduce((a, c) => a + c, 0) / margins.length
      return {
        draft: boqs.filter((b) => b.status === 'draft').length,
        pendingApproval: boqs.filter((b) => isBoqPendingApproval(b.status)).length,
        approved: boqs.filter((b) => b.status === 'approved').length,
        rejected: boqs.filter((b) => b.status === 'rejected').length,
        totalCommercialValue,
        averageMargin,
      }
    },
  })

// --- Audit Log (spec §6.6/§15) ----------------------------------------------

export const useAuditLogs = (entityType?: string) =>
  useQuery({
    queryKey: qk.auditLogs(entityType),
    queryFn: () => repository.listAuditLogs(entityType ? { entityType } : undefined),
  })

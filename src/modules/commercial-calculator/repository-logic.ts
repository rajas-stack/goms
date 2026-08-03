import { uid } from '@/lib/utils'
import { enforceSingleBaseCurrency, findMasterChildren, validateMasterCode, validateParentExists } from './master-rules'
import { STANDARD_EDITION_ID } from './seed-defaults'
import type {
  ApprovalMatrixRule, BoqStatus, CommercialAuditLog, CommercialBoq, CommercialBoqLineItem, CommercialBomItem,
  CommercialCalculatorData, CommercialSku, CreateBoqInput, CreateBoqLineItemInput, CreateBomItemInput,
  CreateMasterInput, CreateSkuInput, Currency, MasterEntityKey, MasterRowMap,
} from './types'

// --- Generic Masters CRUD (Phase 0/1) --------------------------------------

export function listMasterLogic<K extends MasterEntityKey>(data: CommercialCalculatorData, key: K): MasterRowMap[K][] {
  return [...data.masters[key]].sort((a, b) => a.displayOrder - b.displayOrder) as MasterRowMap[K][]
}

export function getMasterLogic<K extends MasterEntityKey>(data: CommercialCalculatorData, key: K, id: string): MasterRowMap[K] | null {
  return (data.masters[key].find((r) => r.id === id) ?? null) as MasterRowMap[K] | null
}

export function createMasterLogic<K extends MasterEntityKey>(
  data: CommercialCalculatorData, key: K, input: CreateMasterInput<K>,
): MasterRowMap[K] {
  const rows = data.masters[key]
  const codeError = validateMasterCode(data.masters, key, (input as unknown as { code: string }).code, null)
  if (codeError) throw new Error(codeError)
  const parentError = validateParentExists(data.masters, key, input as unknown as Record<string, unknown>)
  if (parentError) throw new Error(parentError)

  const row = {
    ...input,
    id: uid('mst'),
    active: input.active ?? true,
    displayOrder: input.displayOrder ?? rows.length,
  } as MasterRowMap[K]
  rows.push(row)

  if (key === 'currencies' && (row as unknown as Currency).isBaseCurrency) {
    enforceSingleBaseCurrency(data.masters.currencies, row.id)
  }
  return row
}

/** `changeReason` is only consulted (and required) when this patch changes a
 *  `features` row's `status` — spec §15/§6.6: feature status changes are one
 *  of the three change types that must carry an audit reason. */
export function updateMasterLogic<K extends MasterEntityKey>(
  data: CommercialCalculatorData, key: K, id: string, patch: Partial<MasterRowMap[K]>, changeReason?: string,
): MasterRowMap[K] {
  const rows = data.masters[key]
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`No such ${key} row: ${id}`)

  if (patch.code !== undefined) {
    const codeError = validateMasterCode(data.masters, key, patch.code as string, id)
    if (codeError) throw new Error(codeError)
  }
  const merged = { ...row, ...patch }
  const parentError = validateParentExists(data.masters, key, merged as unknown as Record<string, unknown>)
  if (parentError) throw new Error(parentError)

  const patchedStatus = (patch as { status?: unknown }).status
  if (key === 'features' && patchedStatus !== undefined && patchedStatus !== (row as { status?: unknown }).status) {
    if (!changeReason?.trim()) throw new Error("changeReason is required when changing a feature's status.")
    writeAuditLogEntry(data, {
      entityType: 'feature', entityId: id, field: 'status',
      oldValue: String((row as { status?: unknown }).status), newValue: String(patchedStatus),
      reason: changeReason, action: 'status_change', changedBy: null,
    })
  }

  Object.assign(row, patch)
  if (key === 'currencies' && (patch as Partial<Currency>).isBaseCurrency) {
    enforceSingleBaseCurrency(data.masters.currencies, id)
  }
  return row
}

export function setMasterActiveLogic(data: CommercialCalculatorData, key: MasterEntityKey, id: string, active: boolean): void {
  const row = data.masters[key].find((r) => r.id === id)
  if (row) row.active = active
}

export function deleteMasterLogic(data: CommercialCalculatorData, key: MasterEntityKey, id: string): void {
  const children = findMasterChildren(data.masters, key, id)
  if (children.length > 0) {
    throw new Error(`Cannot delete this ${key} row — ${children.length} row(s) still reference it.`)
  }
  const masters = data.masters as unknown as Record<MasterEntityKey, { id: string }[]>
  masters[key] = masters[key].filter((r) => r.id !== id)
}

// --- ProductEditionFeature junction (spec §6.2) ----------------------------

export function listEditionFeaturesLogic(data: CommercialCalculatorData, editionId: string) {
  return data.productEditionFeatures
    .filter((r) => r.editionId === editionId)
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

export function setEditionFeaturesLogic(
  data: CommercialCalculatorData, editionId: string, rows: { featureId: string; mandatory: boolean }[],
): void {
  data.productEditionFeatures = data.productEditionFeatures.filter((r) => r.editionId !== editionId)
  rows.forEach((r, i) => {
    data.productEditionFeatures.push({ id: uid('pef'), editionId, featureId: r.featureId, mandatory: r.mandatory, displayOrder: i })
  })
}

// --- SKU code generation & margin (spec §7) --------------------------------

const FEATURE_STATUS_CODE: Record<string, string> = { existing: 'EXG', modified: 'MOD', new: 'NEW' }

function resolveSkuHierarchy(data: CommercialCalculatorData, featureId: string) {
  const feature = data.masters.features.find((f) => f.id === featureId)
  if (!feature) throw new Error(`No such feature: ${featureId}`)
  const module_ = data.masters.modules.find((m) => m.id === feature.moduleId)
  if (!module_) throw new Error(`No such module: ${feature.moduleId}`)
  const product = data.masters.products.find((p) => p.id === module_.productId)
  if (!product) throw new Error(`No such product: ${module_.productId}`)
  const vertical = data.masters.verticals.find((v) => v.id === product.verticalId)
  if (!vertical) throw new Error(`No such vertical: ${product.verticalId}`)
  return { feature, module: module_, product, vertical }
}

/** PCS-012 format: `{Vertical.code}-{Product.code}-{Module.code}-{Feature.code}-{STATUS}`. */
export function generateSkuCode(data: CommercialCalculatorData, featureId: string): string {
  const { feature, module: mod, product, vertical } = resolveSkuHierarchy(data, featureId)
  const statusCode = FEATURE_STATUS_CODE[feature.status] ?? 'NEW'
  return `${vertical.code}-${product.code}-${mod.code}-${feature.code}-${statusCode}`.toUpperCase()
}

/** Sum of the 8 cost fields — shared by SKU-level and BOQ-level margin. */
export function skuTotalUnitCost(sku: CommercialSku): number {
  return sku.baseSoftwareCost + sku.implementationCostPerMM + sku.integrationCost + sku.thirdPartyCost
    + sku.hardwareCost + sku.cloudCost + sku.supportCost + sku.trainingCost
}

export function computeSkuMarginPercent(sku: CommercialSku): number {
  const totalCost = skuTotalUnitCost(sku)
  return sku.listPrice === 0 ? 0 : ((sku.listPrice - totalCost) / sku.listPrice) * 100
}

// --- CommercialSku CRUD (spec §6.3, §14) -----------------------------------

export function listSkusLogic(data: CommercialCalculatorData): CommercialSku[] {
  return [...data.commercialSkus].sort((a, b) => a.displayOrder - b.displayOrder)
}

export function getSkuLogic(data: CommercialCalculatorData, id: string): CommercialSku | null {
  return data.commercialSkus.find((s) => s.id === id) ?? null
}

export function createSkuLogic(data: CommercialCalculatorData, input: CreateSkuInput): CommercialSku {
  const skuCode = generateSkuCode(data, input.featureId)
  if (data.commercialSkus.some((s) => s.skuCode === skuCode)) {
    throw new Error(`A SKU with code "${skuCode}" already exists.`)
  }

  const minimumAllowedPrice = input.minimumAllowedPrice ?? input.floorPrice
  const maximumDiscountPercent = Math.min(90, input.maximumDiscountPercent ?? 90)

  const row: CommercialSku = {
    ...input,
    id: uid('sku'),
    skuCode,
    editionId: input.editionId ?? STANDARD_EDITION_ID,
    displayOrder: input.displayOrder ?? data.commercialSkus.length,
    isSellable: input.isSellable ?? true,
    lifecycleStatus: input.lifecycleStatus ?? 'draft',
    minimumAllowedPrice,
    maximumDiscountPercent,
    createdAt: new Date().toISOString(),
    createdBy: null,
  }
  data.commercialSkus.push(row)
  writeAuditLogEntry(data, {
    entityType: 'sku', entityId: row.id, field: 'skuCode', oldValue: '', newValue: row.skuCode,
    reason: '', action: 'create', changedBy: null,
  })
  return row
}

const SKU_COST_FIELDS = [
  'baseSoftwareCost', 'implementationCostPerMM', 'integrationCost', 'thirdPartyCost',
  'hardwareCost', 'cloudCost', 'supportCost', 'trainingCost',
] as const
const SKU_PRICE_FIELDS = [
  'internalPrice', 'floorPrice', 'partnerPrice', 'governmentPrice', 'enterprisePrice', 'corporatePrice', 'listPrice',
  'minimumAllowedPrice', 'maximumDiscountPercent',
] as const
const SKU_SENSITIVE_FIELDS: (keyof CommercialSku)[] = ['lifecycleStatus', ...SKU_COST_FIELDS, ...SKU_PRICE_FIELDS]

/** `changeReason` is required whenever `patch` touches `lifecycleStatus` or
 *  any cost/pricing field — spec §15/§6.6. */
export function updateSkuLogic(
  data: CommercialCalculatorData, id: string, patch: Partial<CommercialSku>, changeReason?: string,
): CommercialSku {
  const row = data.commercialSkus.find((s) => s.id === id)
  if (!row) throw new Error(`No such SKU: ${id}`)

  const touchedFields = SKU_SENSITIVE_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== row[f])
  if (touchedFields.length > 0 && !changeReason?.trim()) {
    throw new Error('changeReason is required when changing lifecycle status, cost, or pricing fields.')
  }
  for (const field of touchedFields) {
    writeAuditLogEntry(data, {
      entityType: 'sku', entityId: id, field,
      oldValue: String(row[field]), newValue: String(patch[field]),
      reason: changeReason ?? '', action: field === 'lifecycleStatus' ? 'status_change' : 'update', changedBy: null,
    })
  }
  Object.assign(row, patch)
  return row
}

/** PCS-038: throws if any BOQ line item or BOM item still references this SKU. */
export function deleteSkuLogic(data: CommercialCalculatorData, id: string): void {
  const inUse = data.commercialBoqLineItems.some((li) => li.skuId === id)
    || data.commercialBomItems.some((b) => b.parentSkuId === id || b.componentSkuId === id)
  if (inUse) throw new Error('Cannot delete this SKU — it is still referenced by a BOQ line item or BOM entry.')
  data.commercialSkus = data.commercialSkus.filter((s) => s.id !== id)
}

// --- CommercialBomItem CRUD (spec §6.4, §14) -------------------------------

export function listBomItemsForSkuLogic(data: CommercialCalculatorData, parentSkuId: string): CommercialBomItem[] {
  return data.commercialBomItems.filter((b) => b.parentSkuId === parentSkuId)
}

/** Every BOM item across every parent SKU — read-only aggregate, used by the
 *  SKU Catalog list to show how many other SKUs use a given SKU as a
 *  component ("Usage Count"). */
export function listAllBomItemsLogic(data: CommercialCalculatorData): CommercialBomItem[] {
  return data.commercialBomItems
}

export function createBomItemLogic(data: CommercialCalculatorData, input: CreateBomItemInput): CommercialBomItem {
  if (input.parentSkuId === input.componentSkuId) throw new Error('A SKU cannot be a BOM component of itself.')
  if (!data.commercialSkus.some((s) => s.id === input.parentSkuId)) throw new Error(`No such parent SKU: ${input.parentSkuId}`)
  if (!data.commercialSkus.some((s) => s.id === input.componentSkuId)) throw new Error(`No such component SKU: ${input.componentSkuId}`)

  const row: CommercialBomItem = { ...input, id: uid('bom') }
  data.commercialBomItems.push(row)
  return row
}

export function updateBomItemLogic(data: CommercialCalculatorData, id: string, patch: Partial<CommercialBomItem>): CommercialBomItem {
  const row = data.commercialBomItems.find((b) => b.id === id)
  if (!row) throw new Error(`No such BOM item: ${id}`)
  Object.assign(row, patch)
  return row
}

export function deleteBomItemLogic(data: CommercialCalculatorData, id: string): void {
  data.commercialBomItems = data.commercialBomItems.filter((b) => b.id !== id)
}

// --- BOQ number generation (spec §9) ---------------------------------------

/** Format `BOQ-{year}-{6-digit sequence}`. Year-scoped counter that is never
 *  reset; the number is assigned once and never regenerated for a BOQ or any
 *  of its revisions. */
export function generateBoqNumber(data: CommercialCalculatorData): string {
  const year = String(new Date().getFullYear())
  const seq = (data.boqSequenceByYear[year] ?? 0) + 1
  data.boqSequenceByYear[year] = seq
  return `BOQ-${year}-${String(seq).padStart(6, '0')}`
}

// --- CommercialBoq CRUD & lifecycle (spec §6.5, §10, §12, §13) -------------

export function listBoqsLogic(data: CommercialCalculatorData): CommercialBoq[] {
  return [...data.commercialBoqs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function getBoqLogic(data: CommercialCalculatorData, id: string): CommercialBoq | null {
  return data.commercialBoqs.find((b) => b.id === id) ?? null
}

export function listBoqLineItemsLogic(data: CommercialCalculatorData, boqId: string): CommercialBoqLineItem[] {
  return data.commercialBoqLineItems.filter((li) => li.boqId === boqId)
}

/** Every BOQ line item across every BOQ — read-only aggregate, used by the
 *  SKU Catalog list to show how many proposals reference a given SKU
 *  ("BOQ Count"). */
export function listAllBoqLineItemsLogic(data: CommercialCalculatorData): CommercialBoqLineItem[] {
  return data.commercialBoqLineItems
}

export function createBoqLogic(data: CommercialCalculatorData, input: CreateBoqInput): CommercialBoq {
  const now = new Date().toISOString()
  const row: CommercialBoq = {
    ...input,
    id: uid('boq'),
    boqNumber: generateBoqNumber(data),
    status: 'draft',
    boqVersion: 1,
    revisionNumber: 0,
    parentBoqId: null,
    grandTotal: 0,
    createdAt: now,
    createdBy: null,
    lastModifiedAt: now,
    lastModifiedBy: null,
  }
  data.commercialBoqs.push(row)
  writeAuditLogEntry(data, {
    entityType: 'boq', entityId: row.id, field: 'boqNumber', oldValue: '', newValue: row.boqNumber,
    reason: '', action: 'create', changedBy: null,
  })
  return row
}

/** Finds the discount band whose `minDiscountPct` is the highest one at or
 *  below `discountPct`. Bands are contiguous (0-10-25-50-90), so at an exact
 *  boundary (e.g. 10%) this resolves to the STRICTER band above it, not the
 *  auto-approving band below — a deliberate conservative tie-break.
 *
 *  Exported (decoupled from the full `CommercialCalculatorData` blob, which
 *  never reaches the UI layer) so Create BOQ can preview a line's approval
 *  status before it's actually added — same matching logic, no duplication. */
export function resolveApprovalBand(approvalMatrix: ApprovalMatrixRule[], discountPct: number): ApprovalMatrixRule {
  const bands = [...approvalMatrix].sort((a, b) => a.minDiscountPct - b.minDiscountPct)
  let match = bands[0]
  for (const b of bands) if (discountPct >= b.minDiscountPct) match = b
  return match
}

function computeLineTotal(quantity: number, unitPrice: number, discountPct: number, taxPct: number): number {
  return quantity * unitPrice * (1 - discountPct / 100) * (1 + taxPct / 100)
}

export function recomputeBoqGrandTotal(data: CommercialCalculatorData, boqId: string): void {
  const boq = data.commercialBoqs.find((b) => b.id === boqId)
  if (!boq) return
  const lines = data.commercialBoqLineItems.filter((li) => li.boqId === boqId)
  boq.grandTotal = lines.reduce((sum, li) => sum + li.lineTotal, 0)
  boq.lastModifiedAt = new Date().toISOString()
}

export function addBoqLineItemLogic(
  data: CommercialCalculatorData, boqId: string, input: CreateBoqLineItemInput,
): CommercialBoqLineItem {
  const boq = data.commercialBoqs.find((b) => b.id === boqId)
  if (!boq) throw new Error(`No such BOQ: ${boqId}`)
  const sku = data.commercialSkus.find((s) => s.id === input.skuId)
  if (!sku) throw new Error(`No such SKU: ${input.skuId}`)

  const discountPct = Math.max(0, Math.min(input.discountPct, Math.min(90, sku.maximumDiscountPercent)))
  const postDiscountPrice = input.unitPrice * (1 - discountPct / 100)
  if (postDiscountPrice < sku.minimumAllowedPrice) {
    throw new Error(`Discounted unit price (${postDiscountPrice.toFixed(2)}) is below this SKU's minimum allowed price (${sku.minimumAllowedPrice}).`)
  }
  const taxPct = data.masters.taxClasses.find((t) => t.id === sku.taxClassId)?.ratePct ?? 0
  const band = resolveApprovalBand(data.masters.approvalMatrix, discountPct)

  const row: CommercialBoqLineItem = {
    id: uid('bli'),
    boqId,
    skuId: input.skuId,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    discountPct,
    taxPct,
    approverName: input.approverName ?? '',
    approvalDate: null,
    approvalRemarks: input.approvalRemarks ?? '',
    approvalStatus: band.allowAutoApproval ? 'auto_approved' : 'pending',
    lineTotal: computeLineTotal(input.quantity, input.unitPrice, discountPct, taxPct),
  }
  data.commercialBoqLineItems.push(row)
  recomputeBoqGrandTotal(data, boqId)
  return row
}

export function updateBoqLineItemLogic(
  data: CommercialCalculatorData, id: string, patch: Partial<Pick<CommercialBoqLineItem, 'quantity' | 'unitPrice' | 'discountPct' | 'approverName' | 'approvalDate' | 'approvalRemarks' | 'approvalStatus'>>,
): CommercialBoqLineItem {
  const row = data.commercialBoqLineItems.find((li) => li.id === id)
  if (!row) throw new Error(`No such BOQ line item: ${id}`)
  const sku = data.commercialSkus.find((s) => s.id === row.skuId)
  if (!sku) throw new Error(`No such SKU: ${row.skuId}`)

  const quantity = patch.quantity ?? row.quantity
  const unitPrice = patch.unitPrice ?? row.unitPrice
  const discountPct = patch.discountPct !== undefined
    ? Math.max(0, Math.min(patch.discountPct, Math.min(90, sku.maximumDiscountPercent)))
    : row.discountPct

  const postDiscountPrice = unitPrice * (1 - discountPct / 100)
  if (postDiscountPrice < sku.minimumAllowedPrice) {
    throw new Error(`Discounted unit price (${postDiscountPrice.toFixed(2)}) is below this SKU's minimum allowed price (${sku.minimumAllowedPrice}).`)
  }

  Object.assign(row, patch, { quantity, unitPrice, discountPct })
  if (patch.discountPct !== undefined) {
    row.approvalStatus = resolveApprovalBand(data.masters.approvalMatrix, discountPct).allowAutoApproval ? 'auto_approved' : 'pending'
  }
  row.lineTotal = computeLineTotal(quantity, unitPrice, discountPct, row.taxPct)
  recomputeBoqGrandTotal(data, row.boqId)
  return row
}

export function removeBoqLineItemLogic(data: CommercialCalculatorData, id: string): void {
  const row = data.commercialBoqLineItems.find((li) => li.id === id)
  if (!row) return
  data.commercialBoqLineItems = data.commercialBoqLineItems.filter((li) => li.id !== id)
  recomputeBoqGrandTotal(data, row.boqId)
}

/** Spec §10 — `cancelled`/`archived` are terminal, and a decision already
 *  reached (approved/rejected) can only move to `archived`, never `cancelled`. */
export const BOQ_TRANSITIONS: Record<BoqStatus, BoqStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['archived'],
  rejected: ['archived'],
  cancelled: [],
  archived: [],
}

/** Pending Approval is defined by exclusion (spec §10), not enumeration. */
export function isBoqPendingApproval(status: BoqStatus): boolean {
  return !['draft', 'approved', 'rejected', 'cancelled', 'archived'].includes(status)
}

/** `PCS-029` ("validate discounts against approval hierarchy") was, until
 *  this check, enforced only at the line level (`approvalStatus` gets set
 *  by `resolveApprovalBand` when a line is added) — nothing stopped the
 *  document itself from being approved with a line still sitting `pending`.
 *  This is the actual gate; everything upstream of it was only ever a
 *  label. See the business-analysis doc's Phase 4/5 and the control-
 *  classification Phase 7 for why this was the highest-priority gap. */
export function updateBoqStatusLogic(
  data: CommercialCalculatorData, id: string, nextStatus: BoqStatus, changeReason: string,
): CommercialBoq {
  const boq = data.commercialBoqs.find((b) => b.id === id)
  if (!boq) throw new Error(`No such BOQ: ${id}`)
  const allowed = BOQ_TRANSITIONS[boq.status]
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Cannot transition a BOQ from "${boq.status}" to "${nextStatus}".`)
  }
  if (nextStatus === 'approved') {
    const pendingCount = data.commercialBoqLineItems.filter((li) => li.boqId === id && li.approvalStatus === 'pending').length
    if (pendingCount > 0) {
      throw new Error(`Cannot approve this BOQ — ${pendingCount} line item(s) still have a pending discount approval.`)
    }
  }
  const oldStatus = boq.status
  boq.status = nextStatus
  boq.lastModifiedAt = new Date().toISOString()
  writeAuditLogEntry(data, {
    entityType: 'boq', entityId: id, field: 'status', oldValue: oldStatus, newValue: nextStatus,
    reason: changeReason, action: 'status_change', changedBy: null,
  })
  return boq
}

/** Revising a finalized BOQ creates a new row: `boqVersion` incremented,
 *  `revisionNumber` reset, `parentBoqId` set, the immutable `boqNumber`
 *  carried forward (spec §9/§13). Line items are copied so the revision is
 *  independently editable from the version it was revised from. */
export function reviseBoqLogic(data: CommercialCalculatorData, id: string): CommercialBoq {
  const original = data.commercialBoqs.find((b) => b.id === id)
  if (!original) throw new Error(`No such BOQ: ${id}`)
  const now = new Date().toISOString()
  const revised: CommercialBoq = {
    ...original,
    id: uid('boq'),
    status: 'draft',
    boqVersion: original.boqVersion + 1,
    revisionNumber: 0,
    parentBoqId: original.id,
    createdAt: now,
    lastModifiedAt: now,
  }
  data.commercialBoqs.push(revised)

  for (const line of data.commercialBoqLineItems.filter((li) => li.boqId === original.id)) {
    data.commercialBoqLineItems.push({ ...line, id: uid('bli'), boqId: revised.id })
  }
  writeAuditLogEntry(data, {
    entityType: 'boq', entityId: revised.id, field: 'boqVersion', oldValue: String(original.boqVersion), newValue: String(revised.boqVersion),
    reason: 'Revision of an existing BOQ.', action: 'create', changedBy: null,
  })
  return revised
}

// --- Margin (spec §11.1) ----------------------------------------------------

export function computeBoqMarginPercent(
  boq: CommercialBoq, lines: CommercialBoqLineItem[], skusById: Map<string, CommercialSku>,
): number {
  let revenue = 0
  let cost = 0
  for (const line of lines) {
    const sku = skusById.get(line.skuId)
    if (!sku) continue
    revenue += line.quantity * line.unitPrice * (1 - line.discountPct / 100)
    cost += line.quantity * skuTotalUnitCost(sku)
  }
  return revenue === 0 ? 0 : ((revenue - cost) / revenue) * 100
}

// --- Audit log (spec §6.6, §15) --------------------------------------------

export function writeAuditLogEntry(data: CommercialCalculatorData, entry: Omit<CommercialAuditLog, 'id' | 'changedAt'>): CommercialAuditLog {
  const row: CommercialAuditLog = { ...entry, id: uid('aud'), changedAt: new Date().toISOString() }
  data.commercialAuditLogs.push(row)
  return row
}

export function listAuditLogsLogic(
  data: CommercialCalculatorData, filter?: { entityType?: string; entityId?: string },
): CommercialAuditLog[] {
  return data.commercialAuditLogs
    .filter((r) => (!filter?.entityType || r.entityType === filter.entityType) && (!filter?.entityId || r.entityId === filter.entityId))
    .sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1))
}

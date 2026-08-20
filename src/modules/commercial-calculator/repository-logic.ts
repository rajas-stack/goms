import { uid } from '@/lib/utils'
import { conversionFactor, currencyByCode, currencyById } from './currency'
import { enforceSingleBaseCurrency, findMasterChildren, validateMasterCode, validateParentExists } from './master-rules'
import { resolveLineUnitPrice } from './pricing-levels-logic'
import { STANDARD_EDITION_ID } from './seed-defaults'
import type {
  ApprovalMatrixRule, BoqStatus, CommercialAuditLog, CommercialBoq, CommercialBoqLineItem, CommercialBomItem,
  CommercialCalculatorData, CommercialSku, CreateBoqInput, CreateBoqLineItemInput, CreateBomItemInput,
  CreateMasterInput, CreateSkuInput, Currency, MasterEntityKey, MasterRowMap, UpdateBoqInput,
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

/** BOM Option B (cost rollup): a SKU's fully-loaded unit cost is its own
 *  cost fields plus every MANDATORY BOM component's own cost x quantity.
 *  Optional components are excluded — they're a possible add-on, not
 *  unconditionally part of every unit sold, so their cost shouldn't be
 *  baked into a margin figure the customer may never actually incur. One
 *  level deep: a component's own BOM (if it has one) isn't recursed into,
 *  since nested kits aren't a case the catalog has today. */
export function skuTotalUnitCostWithBom(
  sku: CommercialSku, bomItems: CommercialBomItem[], skusById: Map<string, CommercialSku>,
): number {
  const componentCost = bomItems
    .filter((b) => b.parentSkuId === sku.id && b.mandatory)
    .reduce((sum, b) => {
      const component = skusById.get(b.componentSkuId)
      return component ? sum + b.quantity * skuTotalUnitCost(component) : sum
    }, 0)
  return skuTotalUnitCost(sku) + componentCost
}

/** `bomItems`/`skusById` are optional so existing call sites that don't have
 *  BOM data on hand keep their prior (BOM-unaware) behavior unchanged; pass
 *  them to fold in mandatory component costs (`skuTotalUnitCostWithBom`). */
export function computeSkuMarginPercent(
  sku: CommercialSku, bomItems: CommercialBomItem[] = [], skusById: Map<string, CommercialSku> = new Map(),
): number {
  const totalCost = skuTotalUnitCostWithBom(sku, bomItems, skusById)
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
    selectedPricingLevels: input.selectedPricingLevels ?? [],
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
  return [...data.commercialBoqs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((b) => withLiveDraftGrandTotal(data, b))
}

export function getBoqLogic(data: CommercialCalculatorData, id: string): CommercialBoq | null {
  const boq = data.commercialBoqs.find((b) => b.id === id) ?? null
  return boq ? withLiveDraftGrandTotal(data, boq) : null
}

export function listBoqLineItemsLogic(data: CommercialCalculatorData, boqId: string): CommercialBoqLineItem[] {
  const boq = data.commercialBoqs.find((b) => b.id === boqId)
  const lines = data.commercialBoqLineItems.filter((li) => li.boqId === boqId)
  return boq ? withLiveDraftPricing(data, boq, lines) : lines
}

/** A BOQ's line `unitPrice`/`taxPct`/`lineTotal` are snapshots taken from the
 *  SKU at the moment the line was added — once submitted, that snapshot IS
 *  the quoted price and must never move again (an approved customer quote
 *  can't silently change under them). But nothing has been quoted yet while
 *  the BOQ is still a draft, so every read recomputes from the SKU's current
 *  price/tax rate instead of returning a stale snapshot — the same live SKU
 *  data Create BOQ's own preview reads before a line even exists. */
function withLiveDraftPricing(
  data: CommercialCalculatorData, boq: CommercialBoq, lines: CommercialBoqLineItem[],
): CommercialBoqLineItem[] {
  if (boq.status !== 'draft') return lines
  const skusById = new Map(data.commercialSkus.map((s) => [s.id, s]))
  return lines.map((line) => {
    const sku = skusById.get(line.skuId)
    if (!sku) return line
    const taxPct = data.masters.taxClasses.find((t) => t.id === sku.taxClassId)?.ratePct ?? 0
    const factor = skuToBoqConversionFactor(data.masters.currencies, boq.currency, sku)
    const { unitPrice, discountPct } = resolveLineUnitPrice(sku, line.discountPct, line.pricingLevels, line.activePricingLevel)
    return { ...line, unitPrice, discountPct, taxPct, lineTotal: computeLineTotal(line.quantity, unitPrice, discountPct, taxPct, factor) }
  })
}

function withLiveDraftGrandTotal(data: CommercialCalculatorData, boq: CommercialBoq): CommercialBoq {
  if (boq.status !== 'draft') return boq
  const lines = data.commercialBoqLineItems.filter((li) => li.boqId === boq.id)
  const liveLines = withLiveDraftPricing(data, boq, lines)
  const grandTotal = liveLines.reduce((sum, li) => sum + li.lineTotal, 0)
  return grandTotal === boq.grandTotal ? boq : { ...boq, grandTotal }
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

/** BOQ-level metadata patch (BOQ editable-workspace overhaul spec §3) — the
 *  only mutation path for these fields once a BOQ exists; `createBoqLogic`
 *  is otherwise the sole place they're ever set. Rejects outright on a
 *  non-draft BOQ, mirroring the same frozen-snapshot boundary
 *  `withLiveDraftPricing` already applies to line items — metadata edits
 *  never reach an already-submitted/approved/etc. document. */
export function updateBoqLogic(data: CommercialCalculatorData, id: string, patch: UpdateBoqInput): CommercialBoq {
  const boq = data.commercialBoqs.find((b) => b.id === id)
  if (!boq) throw new Error(`No such BOQ: ${id}`)
  if (boq.status !== 'draft') {
    throw new Error('Only a Draft BOQ can have its details edited.')
  }
  const fields = Object.keys(patch) as (keyof UpdateBoqInput)[]
  for (const field of fields) {
    const oldValue = boq[field]
    const newValue = patch[field]
    if (newValue !== undefined && newValue !== oldValue) {
      writeAuditLogEntry(data, {
        entityType: 'boq', entityId: id, field,
        oldValue: oldValue === null ? '' : String(oldValue), newValue: newValue === null ? '' : String(newValue),
        reason: '', action: 'update', changedBy: null,
      })
    }
  }
  Object.assign(boq, patch)
  boq.lastModifiedAt = new Date().toISOString()
  return boq
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

/** `unitPrice`/cost fields on a SKU are always in that SKU's own currency
 *  (`sku.currencyId`); `CommercialBoq.currency` is a single code the whole
 *  document is denominated in. This is the one factor that converts a SKU's
 *  native amount into the BOQ's currency — multiply by it before summing
 *  anything (line totals, revenue, cost) across lines or into the grand
 *  total, so a proposal mixing SKUs priced in different currencies doesn't
 *  silently add unlike units together.
 *
 *  Exported (decoupled from the full `CommercialCalculatorData` blob, which
 *  never reaches the UI layer) so Create BOQ can preview currency-converted
 *  totals before the BOQ or its lines exist yet — same conversion, no
 *  duplication. */
export function skuToBoqConversionFactor(currencies: Currency[], boqCurrencyCode: string, sku: CommercialSku): number {
  return conversionFactor(currencyById(currencies, sku.currencyId), currencyByCode(currencies, boqCurrencyCode))
}

export function computeLineTotal(quantity: number, unitPrice: number, discountPct: number, taxPct: number, factorToBoqCurrency: number): number {
  return quantity * unitPrice * (1 - discountPct / 100) * (1 + taxPct / 100) * factorToBoqCurrency
}

function recomputeBoqGrandTotal(data: CommercialCalculatorData, boqId: string): void {
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
  if (input.quantity <= 0) {
    throw new Error('Quantity must be greater than 0.')
  }

  const discountPct = Math.max(0, Math.min(input.discountPct, Math.min(90, sku.maximumDiscountPercent)))
  // The floor check stays in the SKU's own currency — minimumAllowedPrice is
  // a pricing-policy floor set alongside the SKU's other price fields, and
  // must not loosen or tighten depending on which currency a given proposal
  // happens to be denominated in.
  const postDiscountPrice = input.unitPrice * (1 - discountPct / 100)
  if (postDiscountPrice < sku.minimumAllowedPrice) {
    throw new Error(`Discounted unit price (${postDiscountPrice.toFixed(2)}) is below this SKU's minimum allowed price (${sku.minimumAllowedPrice}).`)
  }
  const taxPct = data.masters.taxClasses.find((t) => t.id === sku.taxClassId)?.ratePct ?? 0
  const band = resolveApprovalBand(data.masters.approvalMatrix, discountPct)
  const factor = skuToBoqConversionFactor(data.masters.currencies, boq.currency, sku)

  const row: CommercialBoqLineItem = {
    id: uid('bli'),
    boqId,
    skuId: input.skuId,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    discountPct,
    taxPct,
    approverId: input.approverId ?? null,
    approvalDate: null,
    approvalRemarks: input.approvalRemarks ?? '',
    approvalStatus: band.allowAutoApproval ? 'auto_approved' : 'pending',
    lineTotal: computeLineTotal(input.quantity, input.unitPrice, discountPct, taxPct, factor),
    pricingLevels: input.pricingLevels ?? [],
    activePricingLevel: input.activePricingLevel ?? null,
  }
  data.commercialBoqLineItems.push(row)
  recomputeBoqGrandTotal(data, boqId)
  return row
}

export function updateBoqLineItemLogic(
  data: CommercialCalculatorData, id: string,
  patch: Partial<Pick<CommercialBoqLineItem,
    'quantity' | 'unitPrice' | 'discountPct' | 'approverId' | 'approvalDate' | 'approvalRemarks' | 'approvalStatus'
    | 'pricingLevels' | 'activePricingLevel'
  >>,
): CommercialBoqLineItem {
  const row = data.commercialBoqLineItems.find((li) => li.id === id)
  if (!row) throw new Error(`No such BOQ line item: ${id}`)
  const sku = data.commercialSkus.find((s) => s.id === row.skuId)
  if (!sku) throw new Error(`No such SKU: ${row.skuId}`)
  const boq = data.commercialBoqs.find((b) => b.id === row.boqId)
  if (!boq) throw new Error(`No such BOQ: ${row.boqId}`)

  const quantity = patch.quantity ?? row.quantity
  if (quantity <= 0) {
    throw new Error('Quantity must be greater than 0.')
  }
  const unitPrice = patch.unitPrice ?? row.unitPrice
  const discountPct = patch.discountPct !== undefined
    ? Math.max(0, Math.min(patch.discountPct, Math.min(90, sku.maximumDiscountPercent)))
    : row.discountPct

  const postDiscountPrice = unitPrice * (1 - discountPct / 100)
  if (postDiscountPrice < sku.minimumAllowedPrice) {
    throw new Error(`Discounted unit price (${postDiscountPrice.toFixed(2)}) is below this SKU's minimum allowed price (${sku.minimumAllowedPrice}).`)
  }

  // Captured before mutating `row` — these become the audit trail's "old" values.
  const oldQuantity = row.quantity
  const oldDiscountPct = row.discountPct

  Object.assign(row, patch, { quantity, unitPrice, discountPct })
  if (patch.discountPct !== undefined) {
    // A changed discount invalidates whatever approval decision (or lack of
    // one) the line had — reusing the same reset a revised/duplicated line
    // gets (`freshLineApprovalState`) so a stale approver/date/remarks never
    // sits next to a discount that's since moved.
    Object.assign(row, freshLineApprovalState(data.masters.approvalMatrix, discountPct))
  }
  const factor = skuToBoqConversionFactor(data.masters.currencies, boq.currency, sku)
  row.lineTotal = computeLineTotal(quantity, unitPrice, discountPct, row.taxPct, factor)
  recomputeBoqGrandTotal(data, row.boqId)

  if (patch.quantity !== undefined && quantity !== oldQuantity) {
    writeAuditLogEntry(data, {
      entityType: 'boqLineItem', entityId: id, field: 'quantity',
      oldValue: String(oldQuantity), newValue: String(quantity),
      reason: '', action: 'update', changedBy: null,
    })
  }
  if (patch.discountPct !== undefined && discountPct !== oldDiscountPct) {
    writeAuditLogEntry(data, {
      entityType: 'boqLineItem', entityId: id, field: 'discountPct',
      oldValue: String(oldDiscountPct), newValue: String(discountPct),
      reason: '', action: 'update', changedBy: null,
    })
  }
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

/** The only two line-level states that mean "this discount is actually
 *  cleared for a customer-facing approval" — everything else (`pending`,
 *  `rejected`, and any future addition to the union) must block the BOQ
 *  itself from reaching `approved`. Written as an explicit whitelist rather
 *  than excluding `pending` alone: excluding just one bad state silently
 *  passes every other one, including `rejected` — a line an approver
 *  explicitly turned down must not be able to ride along to document
 *  approval just because nothing re-checked it. */
export const LINE_STATES_CLEARED_FOR_APPROVAL: CommercialBoqLineItem['approvalStatus'][] = ['auto_approved', 'approved']

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
    const unresolvedCount = data.commercialBoqLineItems
      .filter((li) => li.boqId === id && !LINE_STATES_CLEARED_FOR_APPROVAL.includes(li.approvalStatus)).length
    if (unresolvedCount > 0) {
      throw new Error(`Cannot approve this BOQ — ${unresolvedCount} line item(s) do not have an approved discount status.`)
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

/** A copied line (revise or duplicate) starts a new approval lifecycle
 *  rather than carrying over whatever decision (`approved`/`rejected`) was
 *  made on the line it was copied from — that decision was made against the
 *  old document, not this one. Recomputed from the current discount via the
 *  same approval matrix a freshly-added line would use (not a blanket
 *  `pending`), so a line that was auto-approved because its discount sits in
 *  the auto-approve band stays auto-approved on the copy, and the approver
 *  fields reset so no stale approverId/date/remarks implies a decision was
 *  already made on the new copy. */
export function freshLineApprovalState(approvalMatrix: ApprovalMatrixRule[], discountPct: number) {
  const band = resolveApprovalBand(approvalMatrix, discountPct)
  return {
    approvalStatus: band.allowAutoApproval ? 'auto_approved' as const : 'pending' as const,
    approverId: null, approvalDate: null, approvalRemarks: '',
  }
}

/** A BOQ still in an active pipeline state (`submitted`/`under_review`/
 *  `approved`) must be cancelled first (an existing `BOQ_TRANSITIONS` move)
 *  before it can be deleted — deletion itself is unrestricted once a BOQ
 *  has reached one of these terminal-or-never-left-draft states. */
export const DELETABLE_BOQ_STATUSES: BoqStatus[] = ['draft', 'cancelled', 'rejected', 'archived']

/** Hard-deletes a BOQ and its line items. Line items have no independent
 *  lifecycle of their own (spec §6.5) — they always cascade with their
 *  parent BOQ, the same as `deleteMasterLogic`'s children check exists to
 *  *prevent* for masters that other rows still reference. */
export function deleteBoqLogic(data: CommercialCalculatorData, id: string): void {
  const boq = data.commercialBoqs.find((b) => b.id === id)
  if (!boq) throw new Error(`No such BOQ: ${id}`)
  if (!DELETABLE_BOQ_STATUSES.includes(boq.status)) {
    throw new Error(`Cannot delete a BOQ in "${boq.status}" status — cancel it first.`)
  }
  data.commercialBoqs = data.commercialBoqs.filter((b) => b.id !== id)
  data.commercialBoqLineItems = data.commercialBoqLineItems.filter((li) => li.boqId !== id)
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
    data.commercialBoqLineItems.push({
      ...line, ...freshLineApprovalState(data.masters.approvalMatrix, line.discountPct), id: uid('bli'), boqId: revised.id,
    })
  }
  writeAuditLogEntry(data, {
    entityType: 'boq', entityId: revised.id, field: 'boqVersion', oldValue: String(original.boqVersion), newValue: String(revised.boqVersion),
    reason: 'Revision of an existing BOQ.', action: 'create', changedBy: null,
  })
  return revised
}

/** Creates an independent new BOQ — fresh `boqNumber`, `status: 'draft'`,
 *  `boqVersion: 1`, no `parentBoqId` — copying this BOQ's fields and line
 *  items as a starting point. Distinct from `reviseBoqLogic`, which keeps the
 *  same `boqNumber` and links back via `parentBoqId`: a duplicate is a new,
 *  unrelated proposal that happens to start from an existing one as a
 *  template. Not currently wired to any UI action — no BOQ Management
 *  "Duplicate" button exists yet. */
export function duplicateBoqLogic(data: CommercialCalculatorData, id: string): CommercialBoq {
  const original = data.commercialBoqs.find((b) => b.id === id)
  if (!original) throw new Error(`No such BOQ: ${id}`)
  const now = new Date().toISOString()
  const duplicate: CommercialBoq = {
    ...original,
    id: uid('boq'),
    boqNumber: generateBoqNumber(data),
    status: 'draft',
    boqVersion: 1,
    revisionNumber: 0,
    parentBoqId: null,
    createdAt: now,
    lastModifiedAt: now,
  }
  data.commercialBoqs.push(duplicate)

  for (const line of data.commercialBoqLineItems.filter((li) => li.boqId === original.id)) {
    data.commercialBoqLineItems.push({
      ...line, ...freshLineApprovalState(data.masters.approvalMatrix, line.discountPct), id: uid('bli'), boqId: duplicate.id,
    })
  }
  writeAuditLogEntry(data, {
    entityType: 'boq', entityId: duplicate.id, field: 'boqNumber', oldValue: '', newValue: duplicate.boqNumber,
    reason: `Duplicated from ${original.boqNumber}.`, action: 'create', changedBy: null,
  })
  return duplicate
}

// --- Margin (spec §11.1) ----------------------------------------------------

/** `line.unitPrice` and the SKU's cost fields are both in that SKU's own
 *  currency, so each line's revenue/cost must be converted into the BOQ's
 *  currency (the same factor for both, since it's a straight unit
 *  conversion) before being summed across lines — otherwise mixing SKUs
 *  priced in different currencies distorts the blended margin.
 *
 *  `bomItems` is optional (defaults to `[]`, same BOM-unaware behavior as
 *  before) — pass it to fold each line's SKU's mandatory BOM component
 *  costs into its cost via `skuTotalUnitCostWithBom` (BOM Option B). */
export function computeBoqMarginPercent(
  boq: CommercialBoq, lines: CommercialBoqLineItem[], skusById: Map<string, CommercialSku>, currencies: Currency[],
  bomItems: CommercialBomItem[] = [],
): number {
  let revenue = 0
  let cost = 0
  for (const line of lines) {
    const sku = skusById.get(line.skuId)
    if (!sku) continue
    const factor = skuToBoqConversionFactor(currencies, boq.currency, sku)
    revenue += line.quantity * line.unitPrice * (1 - line.discountPct / 100) * factor
    cost += line.quantity * skuTotalUnitCostWithBom(sku, bomItems, skusById) * factor
  }
  return revenue === 0 ? 0 : ((revenue - cost) / revenue) * 100
}

// --- Audit log (spec §6.6, §15) --------------------------------------------

/** Exported so `audit-log-logic.test.ts` can exercise it directly against
 *  fixture data, matching this file's sibling `repository-logic.test.ts`
 *  convention. Backs the in-memory fallback's own `listAuditLogs` — the
 *  live, Supabase-backed `auditLogs` domain (Phase 5) writes through
 *  `supabase/audit-logs.ts`'s `recordAuditLogEntry` instead. */
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

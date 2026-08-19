import { supabase } from './client'
import { recordAuditLogEntry } from './audit-logs'
import { getMaster, listMaster } from './commercial-masters'
import { getSku, listSkus } from './commercial-skus'
import {
  BOQ_TRANSITIONS, LINE_STATES_CLEARED_FOR_APPROVAL, DELETABLE_BOQ_STATUSES,
  computeLineTotal, freshLineApprovalState, resolveApprovalBand, skuToBoqConversionFactor,
} from '@/modules/commercial-calculator/repository-logic'
import { resolveLineUnitPrice } from '@/modules/commercial-calculator/pricing-levels-logic'
import type {
  BoqStatus, CommercialBoq, CommercialBoqLineItem, CommercialSku, CreateBoqInput, CreateBoqLineItemInput,
} from '@/modules/commercial-calculator/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any

function toBoq(row: AnyRow): CommercialBoq {
  return {
    id: row.id, boqNumber: row.boq_number, opportunityName: row.opportunity_name, departmentId: row.department_id,
    customerName: row.customer_name, customerOrganization: row.customer_organization, customerAddress: row.customer_address,
    customerGst: row.customer_gst, customerContact: row.customer_contact, verticalId: row.vertical_id,
    budgetAmount: row.budget_amount, budgetUnit: row.budget_unit, budgetKnown: row.budget_known,
    emdAmount: row.emd_amount, emdUnit: row.emd_unit,
    salesPersonId: row.sales_person_id, buSalesPersonId: row.bu_sales_person_id, preSalesId: row.pre_sales_id,
    status: row.status, boqVersion: row.boq_version, revisionNumber: row.revision_number, parentBoqId: row.parent_boq_id,
    currency: row.currency, grandTotal: row.grand_total,
    createdAt: row.created_at, createdBy: row.created_by, lastModifiedAt: row.last_modified_at, lastModifiedBy: row.last_modified_by,
  }
}

function toLineItem(row: AnyRow): CommercialBoqLineItem {
  return {
    id: row.id, boqId: row.boq_id, skuId: row.sku_id, quantity: row.quantity, unitPrice: row.unit_price,
    discountPct: row.discount_pct, taxPct: row.tax_pct, approverId: row.approver_id, approvalDate: row.approval_date,
    approvalRemarks: row.approval_remarks, approvalStatus: row.approval_status, lineTotal: row.line_total,
    pricingLevels: row.pricing_levels ?? [], activePricingLevel: row.active_pricing_level ?? null,
  }
}

/** BOQ number generation (spec §9): a Postgres function, not an app-side
 *  read-then-write counter — `allocate_boq_number`'s single
 *  `INSERT ... ON CONFLICT ... RETURNING` statement (Phase 1) makes this
 *  actually atomic under concurrent callers, unlike the in-memory version's
 *  `data.boqSequenceByYear[year]++` (safe only because the in-memory store
 *  has no real concurrency). Same format either way: `BOQ-{year}-{6-digit}`. */
async function generateBoqNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const { data, error } = await supabase.rpc('allocate_boq_number', { p_year: year })
  if (error) throw error
  return data as string
}

/** Fetches the full SKU/tax-class/currency universe once per read — mirrors
 *  the in-memory version's `withLiveDraftPricing`, which scans the full
 *  in-memory `data.commercialSkus`/`data.masters.taxClasses`/
 *  `data.masters.currencies` arrays. Reuses the already-Supabase-backed
 *  `listSkus`/`listMaster` (Phase 3) rather than querying tables directly. */
async function loadPricingContext() {
  const [skus, taxClasses, currencies] = await Promise.all([
    listSkus(), listMaster('taxClasses'), listMaster('currencies'),
  ])
  return { skusById: new Map(skus.map((s) => [s.id, s])), taxClasses, currencies }
}

type PricingContext = Awaited<ReturnType<typeof loadPricingContext>>

/** Direct port of `withLiveDraftPricing` (repository-logic.ts) — recomputes
 *  `unitPrice`/`taxPct`/`lineTotal` from the SKU's *current* price/tax rate
 *  while the parent BOQ is still `draft`; returns snapshot values unchanged
 *  once the BOQ has left `draft` (spec §12 "frozen on submit"). */
function withLiveDraftPricing(boq: CommercialBoq, lines: CommercialBoqLineItem[], ctx: PricingContext): CommercialBoqLineItem[] {
  if (boq.status !== 'draft') return lines
  return lines.map((line) => {
    const sku = ctx.skusById.get(line.skuId)
    if (!sku) return line
    const taxPct = ctx.taxClasses.find((t) => t.id === sku.taxClassId)?.ratePct ?? 0
    const factor = skuToBoqConversionFactor(ctx.currencies, boq.currency, sku)
    const { unitPrice, discountPct } = resolveLineUnitPrice(sku, line.discountPct, line.pricingLevels, line.activePricingLevel)
    return { ...line, unitPrice, discountPct, taxPct, lineTotal: computeLineTotal(line.quantity, unitPrice, discountPct, taxPct, factor) }
  })
}

/** Direct port of `withLiveDraftGrandTotal`. */
function withLiveDraftGrandTotal(boq: CommercialBoq, lines: CommercialBoqLineItem[], ctx: PricingContext): CommercialBoq {
  if (boq.status !== 'draft') return boq
  const liveLines = withLiveDraftPricing(boq, lines, ctx)
  const grandTotal = liveLines.reduce((sum, li) => sum + li.lineTotal, 0)
  return grandTotal === boq.grandTotal ? boq : { ...boq, grandTotal }
}

/** Raw row, no live-pricing transform — used internally by every write path
 *  below, which needs the BOQ's stored `currency`/`status` but must never
 *  trigger a recursive live-price computation. */
async function getBoqRaw(id: string): Promise<CommercialBoq | null> {
  const { data, error } = await supabase.from('commercial_boqs').select('*').eq('id', id).limit(1)
  if (error) throw error
  return data[0] ? toBoq(data[0]) : null
}

async function getLineItemsRaw(boqId: string): Promise<CommercialBoqLineItem[]> {
  const { data, error } = await supabase.from('commercial_boq_line_items').select('*').eq('boq_id', boqId)
  if (error) throw error
  return data.map(toLineItem)
}

/** Direct port of `recomputeBoqGrandTotal` — sums every line's stored
 *  `lineTotal` and persists it onto the parent BOQ, plus bumps
 *  `lastModifiedAt`. Runs after every line add/update/remove regardless of
 *  the BOQ's status (no status guard exists in the source-of-truth logic —
 *  the UI is what restricts editing to draft BOQs, not the repository). */
async function recomputeBoqGrandTotal(boqId: string): Promise<void> {
  const { data, error } = await supabase.from('commercial_boq_line_items').select('line_total').eq('boq_id', boqId)
  if (error) throw error
  const grandTotal = data.reduce((sum: number, r: AnyRow) => sum + r.line_total, 0)
  const { error: updateError } = await supabase.from('commercial_boqs')
    .update({ grand_total: grandTotal, last_modified_at: new Date().toISOString() }).eq('id', boqId)
  if (updateError) throw updateError
}

export async function listBoqs(): Promise<CommercialBoq[]> {
  const { data, error } = await supabase.from('commercial_boqs').select('*').order('created_at', { ascending: false })
  if (error) throw error
  const boqs = data.map(toBoq)
  if (!boqs.some((b) => b.status === 'draft')) return boqs

  const ctx = await loadPricingContext()
  const { data: lineRows, error: lineError } = await supabase
    .from('commercial_boq_line_items').select('*').in('boq_id', boqs.map((b) => b.id))
  if (lineError) throw lineError
  const linesByBoq = new Map<string, CommercialBoqLineItem[]>()
  for (const line of lineRows.map(toLineItem)) {
    linesByBoq.set(line.boqId, [...(linesByBoq.get(line.boqId) ?? []), line])
  }
  return boqs.map((b) => withLiveDraftGrandTotal(b, linesByBoq.get(b.id) ?? [], ctx))
}

export async function getBoq(id: string): Promise<CommercialBoq | null> {
  const boq = await getBoqRaw(id)
  if (!boq || boq.status !== 'draft') return boq
  const lines = await getLineItemsRaw(id)
  const ctx = await loadPricingContext()
  return withLiveDraftGrandTotal(boq, lines, ctx)
}

/** Mirrors `listBoqLineItemsLogic` exactly: if the parent BOQ can't be found,
 *  return whatever line rows exist for that id unfiltered (rather than
 *  throwing) — the in-memory version has the same quirk. */
export async function listBoqLineItems(boqId: string): Promise<CommercialBoqLineItem[]> {
  const [boq, lines] = await Promise.all([getBoqRaw(boqId), getLineItemsRaw(boqId)])
  if (!boq) return lines
  if (boq.status !== 'draft') return lines
  const ctx = await loadPricingContext()
  return withLiveDraftPricing(boq, lines, ctx)
}

/** Every BOQ line item across every BOQ, raw — powers the SKU Catalog's "BOQ
 *  Count" column. Deliberately does NOT apply live-draft pricing, matching
 *  `listAllBoqLineItemsLogic` exactly (it's a usage-count aggregate, never
 *  shown as a price). */
export async function listAllBoqLineItems(): Promise<CommercialBoqLineItem[]> {
  const { data, error } = await supabase.from('commercial_boq_line_items').select('*')
  if (error) throw error
  return data.map(toLineItem)
}

export async function createBoq(input: CreateBoqInput): Promise<CommercialBoq> {
  const boqNumber = await generateBoqNumber()
  const row = {
    boq_number: boqNumber, opportunity_name: input.opportunityName, department_id: input.departmentId,
    customer_name: input.customerName, customer_organization: input.customerOrganization,
    customer_address: input.customerAddress, customer_gst: input.customerGst, customer_contact: input.customerContact,
    vertical_id: input.verticalId,
    budget_amount: input.budgetAmount, budget_unit: input.budgetUnit, budget_known: input.budgetKnown,
    emd_amount: input.emdAmount, emd_unit: input.emdUnit,
    sales_person_id: input.salesPersonId, bu_sales_person_id: input.buSalesPersonId, pre_sales_id: input.preSalesId,
    currency: input.currency,
  }
  const { data, error } = await supabase.from('commercial_boqs').insert(row).select('*').single()
  if (error) throw error
  const created = toBoq(data)

  await recordAuditLogEntry({
    entityType: 'boq', entityId: created.id, field: 'boqNumber', oldValue: '', newValue: created.boqNumber,
    reason: '', action: 'create', changedBy: null,
  })
  return created
}

/** Resolves a SKU's tax rate percentage via its `taxClassId` FK — a single
 *  `getMaster` call rather than fetching the whole `taxClasses` list, since
 *  callers here only ever need one SKU's rate at a time. */
async function taxClassFor(sku: CommercialSku): Promise<number> {
  const taxClass = await getMaster('taxClasses', sku.taxClassId)
  return taxClass?.ratePct ?? 0
}

export async function addBoqLineItem(boqId: string, input: CreateBoqLineItemInput): Promise<CommercialBoqLineItem> {
  const boq = await getBoqRaw(boqId)
  if (!boq) throw new Error(`No such BOQ: ${boqId}`)
  const sku = await getSku(input.skuId)
  if (!sku) throw new Error(`No such SKU: ${input.skuId}`)
  if (input.quantity <= 0) {
    throw new Error('Quantity must be greater than 0.')
  }

  const discountPct = Math.max(0, Math.min(input.discountPct, Math.min(90, sku.maximumDiscountPercent)))
  const postDiscountPrice = input.unitPrice * (1 - discountPct / 100)
  if (postDiscountPrice < sku.minimumAllowedPrice) {
    throw new Error(`Discounted unit price (${postDiscountPrice.toFixed(2)}) is below this SKU's minimum allowed price (${sku.minimumAllowedPrice}).`)
  }
  const taxPct = await taxClassFor(sku)
  const approvalMatrix = await listMaster('approvalMatrix')
  const band = resolveApprovalBand(approvalMatrix, discountPct)
  const currencies = await listMaster('currencies')
  const factor = skuToBoqConversionFactor(currencies, boq.currency, sku)

  const row = {
    boq_id: boqId, sku_id: input.skuId, quantity: input.quantity, unit_price: input.unitPrice,
    discount_pct: discountPct, tax_pct: taxPct, approver_id: input.approverId ?? null, approval_date: null,
    approval_remarks: input.approvalRemarks ?? '', approval_status: band.allowAutoApproval ? 'auto_approved' : 'pending',
    line_total: computeLineTotal(input.quantity, input.unitPrice, discountPct, taxPct, factor),
    pricing_levels: input.pricingLevels ?? [], active_pricing_level: input.activePricingLevel ?? null,
  }
  const { data, error } = await supabase.from('commercial_boq_line_items').insert(row).select('*').single()
  if (error) throw error
  const created = toLineItem(data)
  await recomputeBoqGrandTotal(boqId)
  return created
}

export async function updateBoqLineItem(
  id: string,
  patch: Partial<Pick<CommercialBoqLineItem,
    'quantity' | 'unitPrice' | 'discountPct' | 'approverId' | 'approvalDate' | 'approvalRemarks' | 'approvalStatus'
    | 'pricingLevels' | 'activePricingLevel'
  >>,
): Promise<CommercialBoqLineItem> {
  const { data: existingRows, error: existingError } = await supabase.from('commercial_boq_line_items').select('*').eq('id', id)
  if (existingError) throw existingError
  if (existingRows.length === 0) throw new Error(`No such BOQ line item: ${id}`)
  const existing = toLineItem(existingRows[0])

  const sku = await getSku(existing.skuId)
  if (!sku) throw new Error(`No such SKU: ${existing.skuId}`)
  const boq = await getBoqRaw(existing.boqId)
  if (!boq) throw new Error(`No such BOQ: ${existing.boqId}`)

  const quantity = patch.quantity ?? existing.quantity
  if (quantity <= 0) {
    throw new Error('Quantity must be greater than 0.')
  }
  const unitPrice = patch.unitPrice ?? existing.unitPrice
  const discountPct = patch.discountPct !== undefined
    ? Math.max(0, Math.min(patch.discountPct, Math.min(90, sku.maximumDiscountPercent)))
    : existing.discountPct

  const postDiscountPrice = unitPrice * (1 - discountPct / 100)
  if (postDiscountPrice < sku.minimumAllowedPrice) {
    throw new Error(`Discounted unit price (${postDiscountPrice.toFixed(2)}) is below this SKU's minimum allowed price (${sku.minimumAllowedPrice}).`)
  }

  const merged: CommercialBoqLineItem = { ...existing, ...patch, quantity, unitPrice, discountPct }
  if (patch.discountPct !== undefined) {
    const approvalMatrix = await listMaster('approvalMatrix')
    Object.assign(merged, freshLineApprovalState(approvalMatrix, discountPct))
  }
  const currencies = await listMaster('currencies')
  const factor = skuToBoqConversionFactor(currencies, boq.currency, sku)
  merged.lineTotal = computeLineTotal(quantity, unitPrice, discountPct, merged.taxPct, factor)

  const row = {
    quantity: merged.quantity, unit_price: merged.unitPrice, discount_pct: merged.discountPct,
    approver_id: merged.approverId, approval_date: merged.approvalDate, approval_remarks: merged.approvalRemarks,
    approval_status: merged.approvalStatus, line_total: merged.lineTotal,
    pricing_levels: merged.pricingLevels, active_pricing_level: merged.activePricingLevel,
  }
  const { data, error } = await supabase.from('commercial_boq_line_items').update(row).eq('id', id).select('*').single()
  if (error) throw error
  await recomputeBoqGrandTotal(existing.boqId)

  if (patch.quantity !== undefined && quantity !== existing.quantity) {
    await recordAuditLogEntry({
      entityType: 'boqLineItem', entityId: id, field: 'quantity',
      oldValue: String(existing.quantity), newValue: String(quantity), reason: '', action: 'update', changedBy: null,
    })
  }
  if (patch.discountPct !== undefined && discountPct !== existing.discountPct) {
    await recordAuditLogEntry({
      entityType: 'boqLineItem', entityId: id, field: 'discountPct',
      oldValue: String(existing.discountPct), newValue: String(discountPct), reason: '', action: 'update', changedBy: null,
    })
  }
  return toLineItem(data)
}

/** Silent no-op on a missing id, matching `removeBoqLineItemLogic` exactly
 *  (`if (!row) return`, no throw). */
export async function removeBoqLineItem(id: string): Promise<void> {
  const { data, error } = await supabase.from('commercial_boq_line_items').select('boq_id').eq('id', id)
  if (error) throw error
  if (data.length === 0) return
  const boqId = data[0].boq_id
  const { error: deleteError } = await supabase.from('commercial_boq_line_items').delete().eq('id', id)
  if (deleteError) throw deleteError
  await recomputeBoqGrandTotal(boqId)
}

/** `PCS-029` gate (spec §10): approving is blocked while any line item's
 *  `approvalStatus` isn't in `LINE_STATES_CLEARED_FOR_APPROVAL`
 *  (`auto_approved`/`approved`) — an explicit whitelist, so a `rejected`
 *  line blocks approval exactly like a `pending` one. Counted via a
 *  `head: true` count query rather than fetching every line row. */
export async function updateBoqStatus(id: string, nextStatus: BoqStatus, changeReason: string): Promise<CommercialBoq> {
  const boq = await getBoqRaw(id)
  if (!boq) throw new Error(`No such BOQ: ${id}`)
  const allowed = BOQ_TRANSITIONS[boq.status]
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Cannot transition a BOQ from "${boq.status}" to "${nextStatus}".`)
  }
  if (nextStatus === 'approved') {
    const { count, error: countError } = await supabase
      .from('commercial_boq_line_items').select('*', { count: 'exact', head: true }).eq('boq_id', id)
      .not('approval_status', 'in', `(${LINE_STATES_CLEARED_FOR_APPROVAL.join(',')})`)
    if (countError) throw countError
    if ((count ?? 0) > 0) {
      throw new Error(`Cannot approve this BOQ — ${count} line item(s) do not have an approved discount status.`)
    }
  }

  const { data, error } = await supabase.from('commercial_boqs')
    .update({ status: nextStatus, last_modified_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (error) throw error

  await recordAuditLogEntry({
    entityType: 'boq', entityId: id, field: 'status', oldValue: boq.status, newValue: nextStatus,
    reason: changeReason, action: 'status_change', changedBy: null,
  })
  return toBoq(data)
}

async function copyBoqWithLines(
  original: CommercialBoq, overrides: { boqNumber: string; boqVersion: number; parentBoqId: string | null },
): Promise<CommercialBoq> {
  const row = {
    boq_number: overrides.boqNumber, opportunity_name: original.opportunityName, department_id: original.departmentId,
    customer_name: original.customerName, customer_organization: original.customerOrganization,
    customer_address: original.customerAddress, customer_gst: original.customerGst, customer_contact: original.customerContact,
    vertical_id: original.verticalId,
    budget_amount: original.budgetAmount, budget_unit: original.budgetUnit, budget_known: original.budgetKnown,
    emd_amount: original.emdAmount, emd_unit: original.emdUnit,
    sales_person_id: original.salesPersonId, bu_sales_person_id: original.buSalesPersonId, pre_sales_id: original.preSalesId,
    status: 'draft', boq_version: overrides.boqVersion, revision_number: 0, parent_boq_id: overrides.parentBoqId,
    currency: original.currency,
  }
  const { data, error } = await supabase.from('commercial_boqs').insert(row).select('*').single()
  if (error) throw error
  const copy = toBoq(data)

  const originalLines = await getLineItemsRaw(original.id)
  if (originalLines.length > 0) {
    const approvalMatrix = await listMaster('approvalMatrix')
    const copiedLineRows = originalLines.map((line) => {
      const fresh = freshLineApprovalState(approvalMatrix, line.discountPct)
      return {
        boq_id: copy.id, sku_id: line.skuId, quantity: line.quantity, unit_price: line.unitPrice,
        discount_pct: line.discountPct, tax_pct: line.taxPct, line_total: line.lineTotal,
        approval_status: fresh.approvalStatus, approver_id: fresh.approverId,
        approval_date: fresh.approvalDate, approval_remarks: fresh.approvalRemarks,
        pricing_levels: line.pricingLevels, active_pricing_level: line.activePricingLevel,
      }
    })
    const { error: linesError } = await supabase.from('commercial_boq_line_items').insert(copiedLineRows)
    if (linesError) throw linesError
  }
  return copy
}

/** Carries the original's `boqNumber` forward, `boqVersion + 1`,
 *  `parentBoqId` = the original's id (spec §9/§13). */
export async function reviseBoq(id: string): Promise<CommercialBoq> {
  const original = await getBoqRaw(id)
  if (!original) throw new Error(`No such BOQ: ${id}`)
  const revised = await copyBoqWithLines(original, {
    boqNumber: original.boqNumber, boqVersion: original.boqVersion + 1, parentBoqId: original.id,
  })
  await recordAuditLogEntry({
    entityType: 'boq', entityId: revised.id, field: 'boqVersion',
    oldValue: String(original.boqVersion), newValue: String(revised.boqVersion),
    reason: 'Revision of an existing BOQ.', action: 'create', changedBy: null,
  })
  return revised
}

/** Fresh `boqNumber`, `boqVersion: 1`, no `parentBoqId` — an independent new
 *  BOQ that happens to start from an existing one as a template. Not
 *  currently wired to any UI action (same as the in-memory version). */
export async function duplicateBoq(id: string): Promise<CommercialBoq> {
  const original = await getBoqRaw(id)
  if (!original) throw new Error(`No such BOQ: ${id}`)
  const boqNumber = await generateBoqNumber()
  const duplicate = await copyBoqWithLines(original, { boqNumber, boqVersion: 1, parentBoqId: null })
  await recordAuditLogEntry({
    entityType: 'boq', entityId: duplicate.id, field: 'boqNumber', oldValue: '', newValue: duplicate.boqNumber,
    reason: `Duplicated from ${original.boqNumber}.`, action: 'create', changedBy: null,
  })
  return duplicate
}

/** Hard-deletes a BOQ. Its line items cascade automatically via
 *  `commercial_boq_line_items.boq_id`'s `on delete cascade` FK (Phase 1) —
 *  no separate line-item delete call is needed here, unlike
 *  `deleteBoqLogic`'s explicit in-memory array filter. */
export async function deleteBoq(id: string): Promise<void> {
  const boq = await getBoqRaw(id)
  if (!boq) throw new Error(`No such BOQ: ${id}`)
  if (!DELETABLE_BOQ_STATUSES.includes(boq.status)) {
    throw new Error(`Cannot delete a BOQ in "${boq.status}" status — cancel it first.`)
  }
  const { error } = await supabase.from('commercial_boqs').delete().eq('id', id)
  if (error) throw error
}

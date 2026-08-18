import { supabase } from './client'
import { repository as inMemoryRepository } from '../in-memory/repository'
import type { CommercialSku, CreateSkuInput } from '@/modules/commercial-calculator/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any

const FEATURE_STATUS_CODE: Record<string, string> = { existing: 'EXG', modified: 'MOD', new: 'NEW' }

/** PCS-012 format: `{Vertical.code}-{Product.code}-{Module.code}-{Feature.code}-{STATUS}`.
 *  A single nested-select query walks feature -> module -> product -> vertical
 *  via PostgREST's foreign-table embedding, replacing the in-memory version's
 *  four sequential array `.find()` calls. Every FK in this chain is `not null`
 *  at the schema level (Phase 1), so a feature row that resolves at all
 *  guarantees its module/product/vertical resolve too — no separate
 *  "no such module" existence checks are needed the way the in-memory
 *  version's manual array scans required them. */
async function generateSkuCode(featureId: string): Promise<string> {
  const { data, error } = await supabase
    .from('commercial_features')
    .select('code, status, modules:commercial_modules(code, products:commercial_products(code, verticals:commercial_verticals(code)))')
    .eq('id', featureId)
    .single()
  if (error) throw new Error(`No such feature: ${featureId}`)

  const feature = data as AnyRow
  const module_ = feature.modules
  const product = module_.products
  const vertical = product.verticals
  const statusCode = FEATURE_STATUS_CODE[feature.status] ?? 'NEW'
  return `${vertical.code}-${product.code}-${module_.code}-${feature.code}-${statusCode}`.toUpperCase()
}

/** Replaces the in-memory version's fixed `STANDARD_EDITION_ID = 'ped_standard'`
 *  constant — Supabase ids are DB-generated, so the default edition is
 *  resolved by its stable `code: 'STD'` instead. */
async function resolveDefaultEditionId(): Promise<string> {
  const { data, error } = await supabase.from('commercial_product_editions').select('id').eq('code', 'STD').single()
  if (error) throw new Error('No "STD" product edition found — seed data is missing the Standard edition.')
  return data.id
}

function toSku(row: AnyRow): CommercialSku {
  return {
    id: row.id, skuCode: row.sku_code, name: row.name, categoryId: row.category_id, featureId: row.feature_id,
    editionId: row.edition_id, uomId: row.uom_id, currencyId: row.currency_id, taxClassId: row.tax_class_id,
    billingTypeId: row.billing_type_id, activeFrom: row.active_from, activeTill: row.active_till,
    lifecycleStatus: row.lifecycle_status, isSellable: row.is_sellable, displayOrder: row.display_order,
    baseSoftwareCost: row.base_software_cost, implementationCostPerMM: row.implementation_cost_per_mm,
    integrationCost: row.integration_cost, thirdPartyCost: row.third_party_cost, hardwareCost: row.hardware_cost,
    cloudCost: row.cloud_cost, supportCost: row.support_cost, trainingCost: row.training_cost,
    internalPrice: row.internal_price, floorPrice: row.floor_price, partnerPrice: row.partner_price,
    governmentPrice: row.government_price, enterprisePrice: row.enterprise_price, corporatePrice: row.corporate_price,
    listPrice: row.list_price, minimumAllowedPrice: row.minimum_allowed_price,
    maximumDiscountPercent: row.maximum_discount_percent, createdAt: row.created_at, createdBy: row.created_by,
  }
}

const SKU_FIELD_TO_COLUMN: [keyof CommercialSku, string][] = [
  ['name', 'name'], ['categoryId', 'category_id'], ['featureId', 'feature_id'], ['editionId', 'edition_id'],
  ['uomId', 'uom_id'], ['currencyId', 'currency_id'], ['taxClassId', 'tax_class_id'], ['billingTypeId', 'billing_type_id'],
  ['activeFrom', 'active_from'], ['activeTill', 'active_till'], ['lifecycleStatus', 'lifecycle_status'],
  ['isSellable', 'is_sellable'], ['displayOrder', 'display_order'],
  ['baseSoftwareCost', 'base_software_cost'], ['implementationCostPerMM', 'implementation_cost_per_mm'],
  ['integrationCost', 'integration_cost'], ['thirdPartyCost', 'third_party_cost'], ['hardwareCost', 'hardware_cost'],
  ['cloudCost', 'cloud_cost'], ['supportCost', 'support_cost'], ['trainingCost', 'training_cost'],
  ['internalPrice', 'internal_price'], ['floorPrice', 'floor_price'], ['partnerPrice', 'partner_price'],
  ['governmentPrice', 'government_price'], ['enterprisePrice', 'enterprise_price'], ['corporatePrice', 'corporate_price'],
  ['listPrice', 'list_price'], ['minimumAllowedPrice', 'minimum_allowed_price'],
  ['maximumDiscountPercent', 'maximum_discount_percent'],
]

function toSkuRow(patch: Partial<CommercialSku>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  const raw = patch as AnyRow
  for (const [appField, dbField] of SKU_FIELD_TO_COLUMN) {
    if (raw[appField] !== undefined) row[dbField] = raw[appField]
  }
  return row
}

export async function listSkus(): Promise<CommercialSku[]> {
  const { data, error } = await supabase.from('commercial_skus').select('*').order('display_order', { ascending: true })
  if (error) throw error
  return data.map(toSku)
}

export async function getSku(id: string): Promise<CommercialSku | null> {
  const { data, error } = await supabase.from('commercial_skus').select('*').eq('id', id).limit(1)
  if (error) throw error
  return data[0] ? toSku(data[0]) : null
}

export async function createSku(input: CreateSkuInput): Promise<CommercialSku> {
  const skuCode = await generateSkuCode(input.featureId)
  const { data: clashes, error: clashError } = await supabase.from('commercial_skus').select('id').eq('sku_code', skuCode)
  if (clashError) throw clashError
  if (clashes.length > 0) throw new Error(`A SKU with code "${skuCode}" already exists.`)

  const editionId = input.editionId ?? (await resolveDefaultEditionId())
  const minimumAllowedPrice = input.minimumAllowedPrice ?? input.floorPrice
  const maximumDiscountPercent = Math.min(90, input.maximumDiscountPercent ?? 90)

  let displayOrder = input.displayOrder
  if (displayOrder === undefined) {
    const { count, error: countError } = await supabase.from('commercial_skus').select('*', { count: 'exact', head: true })
    if (countError) throw countError
    displayOrder = count ?? 0
  }

  const row = {
    sku_code: skuCode, name: input.name, category_id: input.categoryId, feature_id: input.featureId,
    edition_id: editionId, uom_id: input.uomId, currency_id: input.currencyId, tax_class_id: input.taxClassId,
    billing_type_id: input.billingTypeId, active_from: input.activeFrom, active_till: input.activeTill,
    lifecycle_status: input.lifecycleStatus ?? 'draft', is_sellable: input.isSellable ?? true, display_order: displayOrder,
    base_software_cost: input.baseSoftwareCost, implementation_cost_per_mm: input.implementationCostPerMM,
    integration_cost: input.integrationCost, third_party_cost: input.thirdPartyCost,
    hardware_cost: input.hardwareCost, cloud_cost: input.cloudCost, support_cost: input.supportCost,
    training_cost: input.trainingCost,
    internal_price: input.internalPrice, floor_price: input.floorPrice, partner_price: input.partnerPrice,
    government_price: input.governmentPrice, enterprise_price: input.enterprisePrice,
    corporate_price: input.corporatePrice, list_price: input.listPrice,
    minimum_allowed_price: minimumAllowedPrice, maximum_discount_percent: maximumDiscountPercent,
  }
  const { data, error } = await supabase.from('commercial_skus').insert(row).select('*').single()
  if (error) throw error
  const created = toSku(data)

  await inMemoryRepository.recordCommercialAuditLogEntry({
    entityType: 'sku', entityId: created.id, field: 'skuCode', oldValue: '', newValue: created.skuCode,
    reason: '', action: 'create', changedBy: null,
  })
  return created
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
export async function updateSku(id: string, patch: Partial<CommercialSku>, changeReason?: string): Promise<CommercialSku> {
  const existing = await getSku(id)
  if (!existing) throw new Error(`No such SKU: ${id}`)

  const touchedFields = SKU_SENSITIVE_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== existing[f])
  if (touchedFields.length > 0 && !changeReason?.trim()) {
    throw new Error('changeReason is required when changing lifecycle status, cost, or pricing fields.')
  }
  for (const field of touchedFields) {
    await inMemoryRepository.recordCommercialAuditLogEntry({
      entityType: 'sku', entityId: id, field,
      oldValue: String(existing[field]), newValue: String(patch[field]),
      reason: changeReason ?? '', action: field === 'lifecycleStatus' ? 'status_change' : 'update', changedBy: null,
    })
  }

  const row = toSkuRow(patch)
  const { data, error } = await supabase.from('commercial_skus').update(row as never).eq('id', id).select('*').single()
  if (error) throw error
  return toSku(data)
}

/** PCS-038: throws if any BOQ line item or BOM item still references this SKU.
 *
 *  BOM usage is checked directly against Postgres — commercialBom migrated
 *  in this same plan's Task 4. BOQ-line-item usage remains a bridge into the
 *  still-in-memory blob: commercialBoqs doesn't migrate until Phase 4. See
 *  the Phase 3 plan's Global Constraints. */
export async function deleteSku(id: string): Promise<void> {
  const { data: bomRows, error: bomError } = await supabase
    .from('commercial_bom_items').select('id').or(`parent_sku_id.eq.${id},component_sku_id.eq.${id}`).limit(1)
  if (bomError) throw bomError

  const boqLineItems = await inMemoryRepository.listAllBoqLineItems()
  const boqInUse = boqLineItems.some((li) => li.skuId === id)

  if (bomRows.length > 0 || boqInUse) {
    throw new Error('Cannot delete this SKU — it is still referenced by a BOQ line item or BOM entry.')
  }
  const { error } = await supabase.from('commercial_skus').delete().eq('id', id)
  if (error) throw error
}

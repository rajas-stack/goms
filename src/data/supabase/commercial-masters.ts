import { supabase } from './client'
import { repository as inMemoryRepository } from '../in-memory/repository'
import type { CreateMasterInput, MasterEntityKey, MasterRowMap, ProductEditionFeature } from '@/modules/commercial-calculator/types'

// A dozen master tables share the same 6-column shape (id/code/name/
// description/active/display_order) plus a handful of key-specific extra
// columns — one generic implementation keyed by these two maps, not 12
// hand-written CRUD files. Same "any" escape hatch already established by
// src/data/supabase/hierarchy.ts for the same reason (structurally similar,
// nominally distinct tables dispatched at runtime).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any

/** Same escape hatch as `hierarchy.ts`'s `fromTable` — supabase-js's `.from()`
 *  overloads require a literal table name to type the rest of the chain, but
 *  the table is chosen at runtime here (one of 12, keyed by `MasterEntityKey`).
 *  Returning `any` lets every chained `.select`/`.insert`/`.update`/`.delete`
 *  call through without fighting the generated `Database` types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromTable(table: string): any {
  return supabase.from(table as never)
}

const TABLE_FOR_KEY: Record<MasterEntityKey, string> = {
  verticals: 'commercial_verticals',
  products: 'commercial_products',
  modules: 'commercial_modules',
  features: 'commercial_features',
  skuCategories: 'commercial_sku_categories',
  unitsOfMeasure: 'commercial_units_of_measure',
  productEditions: 'commercial_product_editions',
  billingTypes: 'commercial_billing_types',
  taxClasses: 'commercial_tax_classes',
  approvalMatrix: 'commercial_approval_matrix',
  currencies: 'commercial_currencies',
  preSales: 'commercial_pre_sales',
}

/** Extra (non-`MasterBase`) app-field -> db-column pairs per master kind,
 *  beyond the 6 columns every master table shares. Empty for the 7 "flat"
 *  master kinds (verticals/skuCategories/unitsOfMeasure/productEditions/
 *  billingTypes/preSales — plus features' own extra pair below). */
const EXTRA_FIELDS: Record<MasterEntityKey, [string, string][]> = {
  verticals: [],
  products: [['verticalId', 'vertical_id']],
  modules: [['productId', 'product_id']],
  features: [['moduleId', 'module_id'], ['status', 'status']],
  skuCategories: [],
  unitsOfMeasure: [],
  productEditions: [],
  billingTypes: [],
  taxClasses: [['ratePct', 'rate_pct']],
  approvalMatrix: [
    ['minDiscountPct', 'min_discount_pct'], ['maxDiscountPct', 'max_discount_pct'],
    ['approvalLevelLabel', 'approval_level_label'], ['allowAutoApproval', 'allow_auto_approval'],
  ],
  currencies: [
    ['symbol', 'symbol'], ['decimalPlaces', 'decimal_places'],
    ['exchangeRate', 'exchange_rate'], ['isBaseCurrency', 'is_base_currency'],
  ],
  preSales: [],
}

/** Parent-FK field for each hierarchy master, keyed by child — ports
 *  master-rules.ts's PARENT_FIELD, now as a Postgres existence check instead
 *  of an in-memory array scan. */
const PARENT_FIELD: Partial<Record<MasterEntityKey, { parentKey: MasterEntityKey; dbField: string; appField: string }>> = {
  products: { parentKey: 'verticals', dbField: 'vertical_id', appField: 'verticalId' },
  modules: { parentKey: 'products', dbField: 'product_id', appField: 'productId' },
  features: { parentKey: 'modules', dbField: 'module_id', appField: 'moduleId' },
}

/** Inverse of `PARENT_FIELD` — ports master-rules.ts's CHILD_OF, driving the
 *  delete guard (a row with children can't be deleted out from under them). */
const CHILD_OF: Partial<Record<MasterEntityKey, { childKey: MasterEntityKey; dbField: string }>> = {
  verticals: { childKey: 'products', dbField: 'vertical_id' },
  products: { childKey: 'modules', dbField: 'product_id' },
  modules: { childKey: 'features', dbField: 'module_id' },
}

function toMaster<K extends MasterEntityKey>(key: K, row: AnyRow): MasterRowMap[K] {
  const base: AnyRow = {
    id: row.id, code: row.code, name: row.name, description: row.description,
    active: row.active, displayOrder: row.display_order,
  }
  for (const [appField, dbField] of EXTRA_FIELDS[key]) base[appField] = row[dbField]
  return base as MasterRowMap[K]
}

function toRow<K extends MasterEntityKey>(key: K, input: AnyRow): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (input.code !== undefined) row.code = input.code
  if (input.name !== undefined) row.name = input.name
  if (input.description !== undefined) row.description = input.description
  if (input.active !== undefined) row.active = input.active
  if (input.displayOrder !== undefined) row.display_order = input.displayOrder
  for (const [appField, dbField] of EXTRA_FIELDS[key]) {
    if (input[appField] !== undefined) row[dbField] = input[appField]
  }
  return row
}

async function validateMasterCode<K extends MasterEntityKey>(
  key: K, code: string, excludeId: string | null,
): Promise<string | null> {
  const trimmed = code.trim()
  if (!trimmed) return 'Code is required.'
  let query = fromTable(TABLE_FOR_KEY[key]).select('id').ilike('code', trimmed)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query
  if (error) throw error
  return data.length > 0 ? `Code "${trimmed}" is already used by another ${key} row.` : null
}

async function validateParentExists<K extends MasterEntityKey>(key: K, merged: AnyRow): Promise<string | null> {
  const rule = PARENT_FIELD[key]
  if (!rule) return null
  const parentId = merged[rule.appField]
  if (typeof parentId !== 'string' || !parentId) return `${rule.appField} is required.`
  const { data, error } = await fromTable(TABLE_FOR_KEY[rule.parentKey]).select('id').eq('id', parentId).limit(1)
  if (error) throw error
  return data.length > 0 ? null : `No such ${rule.parentKey} row: ${parentId}`
}

/** Returns the exact count of referencing child rows (not just whether any
 *  exist) — deleteMaster's error message reports the count, matching the
 *  in-memory version's `${children.length} row(s)` text exactly. */
async function countMasterChildren<K extends MasterEntityKey>(key: K, id: string): Promise<number> {
  const rule = CHILD_OF[key]
  if (!rule) return 0
  const { count, error } = await fromTable(TABLE_FOR_KEY[rule.childKey])
    .select('*', { count: 'exact', head: true }).eq(rule.dbField, id)
  if (error) throw error
  return count ?? 0
}

/** Clears every other row's `is_base_currency` BEFORE the new winner is
 *  inserted/updated — never after. `commercial_currencies_one_base_idx` (a
 *  partial unique index on `is_base_currency where is_base_currency`) allows
 *  at most one `true` row at any instant, so setting a second row true while
 *  the old winner is still true throws a unique-violation immediately; only
 *  clear-then-set avoids ever having two `true` rows at once. `exceptId` is
 *  `null` on create (the new row doesn't exist yet, nothing to exclude) and
 *  the row's own id on update (so clearing doesn't also unset the row this
 *  same call is about to set true). */
async function clearExistingBaseCurrency(exceptId: string | null): Promise<void> {
  let query = supabase.from('commercial_currencies').update({ is_base_currency: false }).eq('is_base_currency', true)
  if (exceptId) query = query.neq('id', exceptId)
  const { error } = await query
  if (error) throw error
}

export async function listMaster<K extends MasterEntityKey>(key: K): Promise<MasterRowMap[K][]> {
  const { data, error } = await fromTable(TABLE_FOR_KEY[key]).select('*').order('display_order', { ascending: true })
  if (error) throw error
  return data.map((r: AnyRow) => toMaster(key, r))
}

export async function getMaster<K extends MasterEntityKey>(key: K, id: string): Promise<MasterRowMap[K] | null> {
  const { data, error } = await fromTable(TABLE_FOR_KEY[key]).select('*').eq('id', id).limit(1)
  if (error) throw error
  return data[0] ? toMaster(key, data[0]) : null
}

export async function createMaster<K extends MasterEntityKey>(key: K, input: CreateMasterInput<K>): Promise<MasterRowMap[K]> {
  const raw = input as AnyRow
  const codeError = await validateMasterCode(key, raw.code, null)
  if (codeError) throw new Error(codeError)
  const parentError = await validateParentExists(key, raw)
  if (parentError) throw new Error(parentError)

  if (key === 'currencies' && raw.isBaseCurrency) {
    await clearExistingBaseCurrency(null)
  }

  const row = toRow(key, raw)
  row.active = raw.active ?? true
  if (raw.displayOrder === undefined) {
    const { count, error: countError } = await fromTable(TABLE_FOR_KEY[key]).select('*', { count: 'exact', head: true })
    if (countError) throw countError
    row.display_order = count ?? 0
  }

  const { data, error } = await fromTable(TABLE_FOR_KEY[key]).insert(row).select('*').single()
  if (error) throw error
  return toMaster(key, data)
}

/** `changeReason` is only consulted (and required) when this patch changes a
 *  `features` row's `status` — spec §15/§6.6. */
export async function updateMaster<K extends MasterEntityKey>(
  key: K, id: string, patch: Partial<MasterRowMap[K]>, changeReason?: string,
): Promise<MasterRowMap[K]> {
  const existing = await getMaster(key, id)
  if (!existing) throw new Error(`No such ${key} row: ${id}`)

  const rawPatch = patch as AnyRow
  if (rawPatch.code !== undefined) {
    const codeError = await validateMasterCode(key, rawPatch.code, id)
    if (codeError) throw new Error(codeError)
  }
  const merged = { ...existing, ...rawPatch }
  const parentError = await validateParentExists(key, merged)
  if (parentError) throw new Error(parentError)

  const patchedStatus = rawPatch.status
  if (key === 'features' && patchedStatus !== undefined && patchedStatus !== (existing as AnyRow).status) {
    if (!changeReason?.trim()) throw new Error("changeReason is required when changing a feature's status.")
    await inMemoryRepository.recordCommercialAuditLogEntry({
      entityType: 'feature', entityId: id, field: 'status',
      oldValue: String((existing as AnyRow).status), newValue: String(patchedStatus),
      reason: changeReason, action: 'status_change', changedBy: null,
    })
  }

  if (key === 'currencies' && rawPatch.isBaseCurrency) {
    await clearExistingBaseCurrency(id)
  }

  const row = toRow(key, rawPatch)
  const { data, error } = await fromTable(TABLE_FOR_KEY[key]).update(row).eq('id', id).select('*').single()
  if (error) throw error
  return toMaster(key, data)
}

/** Silent no-op if `id` doesn't exist — preserves the in-memory version's
 *  exact quirk (`if (row) row.active = active`, no throw on a missing id). */
export async function setMasterActive(key: MasterEntityKey, id: string, active: boolean): Promise<void> {
  const { error } = await fromTable(TABLE_FOR_KEY[key]).update({ active }).eq('id', id)
  if (error) throw error
}

/** Throws if any child master row still references this one. Silent no-op
 *  (not a throw) if `id` itself doesn't exist — same preserved quirk as
 *  `setMasterActive`. */
export async function deleteMaster(key: MasterEntityKey, id: string): Promise<void> {
  const childCount = await countMasterChildren(key, id)
  if (childCount > 0) {
    throw new Error(`Cannot delete this ${key} row — ${childCount} row(s) still reference it.`)
  }
  const { error } = await fromTable(TABLE_FOR_KEY[key]).delete().eq('id', id)
  if (error) throw error
}

export async function listEditionFeatures(editionId: string): Promise<ProductEditionFeature[]> {
  const { data, error } = await supabase
    .from('commercial_product_edition_features').select('*').eq('edition_id', editionId)
    .order('display_order', { ascending: true })
  if (error) throw error
  return data.map((r) => ({
    id: r.id, editionId: r.edition_id, featureId: r.feature_id, mandatory: r.mandatory, displayOrder: r.display_order,
  }))
}

/** Full replace, matching the in-memory version exactly: delete every
 *  existing row for this edition, then insert the new set in order. */
export async function setEditionFeatures(
  editionId: string, rows: { featureId: string; mandatory: boolean }[],
): Promise<void> {
  const { error: deleteError } = await supabase.from('commercial_product_edition_features').delete().eq('edition_id', editionId)
  if (deleteError) throw deleteError
  if (rows.length === 0) return
  const insertRows = rows.map((r, i) => ({
    edition_id: editionId, feature_id: r.featureId, mandatory: r.mandatory, display_order: i,
  }))
  const { error: insertError } = await supabase.from('commercial_product_edition_features').insert(insertRows)
  if (insertError) throw insertError
}

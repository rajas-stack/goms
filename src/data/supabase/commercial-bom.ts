import { supabase } from './client'
import type { CommercialBomItem, CreateBomItemInput } from '@/modules/commercial-calculator/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any

function toBomItem(row: AnyRow): CommercialBomItem {
  return {
    id: row.id, parentSkuId: row.parent_sku_id, componentSkuId: row.component_sku_id,
    mandatory: row.mandatory, quantity: row.quantity, notes: row.notes,
  }
}

export async function listBomItemsForSku(parentSkuId: string): Promise<CommercialBomItem[]> {
  const { data, error } = await supabase.from('commercial_bom_items').select('*').eq('parent_sku_id', parentSkuId)
  if (error) throw error
  return data.map(toBomItem)
}

/** Every BOM item across every parent SKU — read-only aggregate for the SKU
 *  Catalog's "Usage Count" column. */
export async function listAllBomItems(): Promise<CommercialBomItem[]> {
  const { data, error } = await supabase.from('commercial_bom_items').select('*')
  if (error) throw error
  return data.map(toBomItem)
}

/** Rejects direct self-reference in application code (matching the in-memory
 *  version) — the `CHECK (parent_sku_id <> component_sku_id)` constraint from
 *  Phase 1 is defense-in-depth, not the primary error path, so callers still
 *  get the friendly message instead of a raw Postgres constraint error. */
export async function createBomItem(input: CreateBomItemInput): Promise<CommercialBomItem> {
  if (input.parentSkuId === input.componentSkuId) throw new Error('A SKU cannot be a BOM component of itself.')

  const { data: parentRows, error: parentError } = await supabase.from('commercial_skus').select('id').eq('id', input.parentSkuId).limit(1)
  if (parentError) throw parentError
  if (parentRows.length === 0) throw new Error(`No such parent SKU: ${input.parentSkuId}`)

  const { data: componentRows, error: componentError } = await supabase.from('commercial_skus').select('id').eq('id', input.componentSkuId).limit(1)
  if (componentError) throw componentError
  if (componentRows.length === 0) throw new Error(`No such component SKU: ${input.componentSkuId}`)

  const row = {
    parent_sku_id: input.parentSkuId, component_sku_id: input.componentSkuId,
    mandatory: input.mandatory, quantity: input.quantity, notes: input.notes,
  }
  const { data, error } = await supabase.from('commercial_bom_items').insert(row).select('*').single()
  if (error) throw error
  return toBomItem(data)
}

/** `.select('*')` without `.single()` so a missing id produces an empty array
 *  to check explicitly, rather than `.single()`'s generic PGRST116 error —
 *  needed to throw the exact `No such BOM item: ${id}` message the in-memory
 *  version does. */
export async function updateBomItem(id: string, patch: Partial<CommercialBomItem>): Promise<CommercialBomItem> {
  const row: Record<string, unknown> = {}
  if (patch.parentSkuId !== undefined) row.parent_sku_id = patch.parentSkuId
  if (patch.componentSkuId !== undefined) row.component_sku_id = patch.componentSkuId
  if (patch.mandatory !== undefined) row.mandatory = patch.mandatory
  if (patch.quantity !== undefined) row.quantity = patch.quantity
  if (patch.notes !== undefined) row.notes = patch.notes

  const { data, error } = await supabase.from('commercial_bom_items').update(row as never).eq('id', id).select('*')
  if (error) throw error
  if (data.length === 0) throw new Error(`No such BOM item: ${id}`)
  return toBomItem(data[0])
}

export async function deleteBomItem(id: string): Promise<void> {
  const { error } = await supabase.from('commercial_bom_items').delete().eq('id', id)
  if (error) throw error
}

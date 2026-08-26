import { z } from 'zod'
import { classifyRows } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

function bomKey(parentSkuCode: string, componentSkuCode: string): string {
  return `${normalizeCode(parentSkuCode)}|${normalizeCode(componentSkuCode)}`
}

const bomRowSchema = z.object({
  parentSkuCode: z.string().min(1, 'Parent SKU Code is required').trim(),
  componentSkuCode: z.string().min(1, 'Component SKU Code is required').trim(),
  mandatory: z.boolean().optional().default(false),
  quantity: z.number({ invalid_type_error: 'Quantity must be a number' }).optional().default(1),
  notes: z.string().optional().default(''),
})
export type BomRow = z.infer<typeof bomRowSchema>

interface ExistingBomItem {
  mandatory: boolean
  quantity: number
  notes: string
  parentSkuId: string
  componentSkuId: string
}

/** Best-effort (Parent, Component) key extraction straight off the raw row,
 *  used only for within-file duplicate keying before schema validation runs
 *  — mirrors every other importer's raw-field fallback for its own business
 *  key, so two equally-invalid rows are still correctly flagged as
 *  duplicates of each other rather than each minting an unrelated synthetic
 *  key. */
function rawBomKey(raw: unknown, index: number): string {
  if (typeof raw !== 'object' || raw === null) return `__row_${index}__`
  const obj = raw as Record<string, unknown>
  const parent = typeof obj.parentSkuCode === 'string' ? obj.parentSkuCode.trim() : ''
  const component = typeof obj.componentSkuCode === 'string' ? obj.componentSkuCode.trim() : ''
  if (parent === '' || component === '') return `__row_${index}__`
  return bomKey(parent, component)
}

async function fetchExistingSkuIdsByCode(client: { query: Function }): Promise<Map<string, string>> {
  const result = await client.query(`SELECT id, sku_code FROM commercial_skus`)
  const map = new Map<string, string>()
  for (const row of result.rows) map.set(normalizeCode(row.sku_code), row.id)
  return map
}

async function fetchExistingBomItems(client: { query: Function }): Promise<Map<string, ExistingBomItem>> {
  const result = await client.query(
    `SELECT b.mandatory, b.quantity, b.notes, b.parent_sku_id, b.component_sku_id,
            p.sku_code AS parent_sku_code, c.sku_code AS component_sku_code
     FROM commercial_bom_items b
     JOIN commercial_skus p ON p.id = b.parent_sku_id
     JOIN commercial_skus c ON c.id = b.component_sku_id`,
  )
  const map = new Map<string, ExistingBomItem>()
  for (const row of result.rows) {
    map.set(bomKey(row.parent_sku_code, row.component_sku_code), {
      mandatory: row.mandatory,
      quantity: Number(row.quantity),
      notes: row.notes,
      parentSkuId: row.parent_sku_id,
      componentSkuId: row.component_sku_id,
    })
  }
  return map
}

export async function validateBomRows(client: { query: Function }, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const skuIdByCode = await fetchExistingSkuIdsByCode(client)
  const existingByKey = await fetchExistingBomItems(client)

  return classifyRows<unknown, ExistingBomItem>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = bomRowSchema.safeParse(raw)
      if (parsed.success) return bomKey(parsed.data.parentSkuCode, parsed.data.componentSkuCode)
      return rawBomKey(raw, index)
    },
    existingByKey,
    diffFields: (raw, existing) => {
      const row = bomRowSchema.parse(raw)
      const diffs: ImportFieldDiff[] = []
      if (row.mandatory !== existing.mandatory) diffs.push({ field: 'mandatory', oldValue: existing.mandatory, newValue: row.mandatory })
      if (row.quantity !== existing.quantity) diffs.push({ field: 'quantity', oldValue: existing.quantity, newValue: row.quantity })
      if (row.notes !== existing.notes) diffs.push({ field: 'notes', oldValue: existing.notes, newValue: row.notes })
      return diffs
    },
    validateRow: (raw) => {
      const parsed = bomRowSchema.safeParse(raw)
      if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      const row = parsed.data
      const errors: string[] = []
      // Matches commercial.ts:640's existing app rule verbatim.
      if (normalizeCode(row.parentSkuCode) === normalizeCode(row.componentSkuCode)) {
        errors.push('A SKU cannot be a BOM component of itself.')
      }
      if (!skuIdByCode.has(normalizeCode(row.parentSkuCode))) {
        errors.push(`Parent SKU Code "${row.parentSkuCode}" does not match any existing SKU.`)
      }
      if (!skuIdByCode.has(normalizeCode(row.componentSkuCode))) {
        errors.push(`Component SKU Code "${row.componentSkuCode}" does not match any existing SKU.`)
      }
      return errors
    },
  })
}

export async function commitBomRows(
  client: { query: Function },
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  const skuIdByCode = await fetchExistingSkuIdsByCode(client)

  for (let i = 0; i < rawRows.length; i++) {
    const result = preview[i]
    if (!result || (result.action !== 'create' && result.action !== 'update')) continue
    const row = bomRowSchema.parse(rawRows[i])
    // Guaranteed defined: validateBomRows already rejected any row whose
    // Parent/Component SKU Code doesn't resolve against the database.
    const parentSkuId = skuIdByCode.get(normalizeCode(row.parentSkuCode))!
    const componentSkuId = skuIdByCode.get(normalizeCode(row.componentSkuCode))!

    if (result.action === 'create') {
      await client.query(
        `INSERT INTO commercial_bom_items (parent_sku_id, component_sku_id, mandatory, quantity, notes)
         VALUES ($1,$2,$3,$4,$5)`,
        [parentSkuId, componentSkuId, row.mandatory, row.quantity, row.notes],
      )
    } else {
      await client.query(
        `UPDATE commercial_bom_items SET mandatory=$3, quantity=$4, notes=$5
         WHERE parent_sku_id=$1 AND component_sku_id=$2`,
        [parentSkuId, componentSkuId, row.mandatory, row.quantity, row.notes],
      )
    }
  }
}

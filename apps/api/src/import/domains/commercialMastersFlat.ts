import { z } from 'zod'
import { classifyRows } from '../engine.js'
import type { ImportRowResult } from '../types.js'

/** The four independent flat reference-list master kinds this module covers
 *  (spec §"6. Commercial Masters — Flat Reference Lists"). Each is a separate
 *  sheet in the uploaded workbook but shares one identical schema and
 *  validation/commit path — parameterized here by `sheetKey` rather than
 *  four near-duplicate modules, matching `taxClasses.ts`'s shape exactly
 *  minus the `extra` JSONB field (`MASTER_EXTRA_FIELDS` is `[]` for all four
 *  per `packages/domain/src/commercial.ts`). */
export type FlatMasterSheetKey = 'skuCategories' | 'unitsOfMeasure' | 'productEditions' | 'billingTypes'

const flatMasterRowSchema = z.object({
  code: z.string().min(1, 'Code is required').trim(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  active: z.boolean().optional().default(true),
  displayOrder: z.number().optional().default(0),
})
export type FlatMasterRow = z.infer<typeof flatMasterRowSchema>

interface ExistingFlatMaster {
  id: string
  name: string
  description: string
  active: boolean
  displayOrder: number
}

async function fetchExisting(
  client: { query: Function },
  sheetKey: FlatMasterSheetKey,
): Promise<Map<string, ExistingFlatMaster>> {
  const result = await client.query(`SELECT * FROM commercial_masters WHERE master_key=$1`, [sheetKey])
  const map = new Map<string, ExistingFlatMaster>()
  for (const row of result.rows) {
    map.set(row.code.trim().toUpperCase(), {
      id: row.id, name: row.name, description: row.description,
      active: row.active, displayOrder: row.display_order,
    })
  }
  return map
}

export async function validateFlatMasterRows(
  client: { query: Function },
  sheetKey: FlatMasterSheetKey,
  rawRows: unknown[],
): Promise<ImportRowResult[]> {
  const existingByKey = await fetchExisting(client, sheetKey)
  return classifyRows<unknown, ExistingFlatMaster>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = flatMasterRowSchema.safeParse(raw)
      if (parsed.success) return parsed.data.code.toUpperCase()
      if (typeof raw !== 'object' || raw === null) return null
      const rawCode = (raw as Record<string, unknown>).code
      if (typeof rawCode === 'string' && rawCode.trim() !== '') return rawCode.trim().toUpperCase()
      // Blank/missing/non-string code: still a distinct, valid row — key it
      // by its own position so it reaches validateRow (and gets the precise
      // "Code is required" message) instead of being silently swallowed as
      // a "duplicate" of some other row that also happens to have no code.
      return `__row_${index}__`
    },
    existingByKey,
    diffFields: (raw, existing) => {
      const row = flatMasterRowSchema.parse(raw)
      const diffs = []
      if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
      if (row.description !== existing.description) diffs.push({ field: 'description', oldValue: existing.description, newValue: row.description })
      if (row.active !== existing.active) diffs.push({ field: 'active', oldValue: existing.active, newValue: row.active })
      return diffs
    },
    validateRow: (raw) => {
      const parsed = flatMasterRowSchema.safeParse(raw)
      if (parsed.success) return { errors: [] }
      return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
    },
  })
}

export async function commitFlatMasterRows(
  client: { query: Function },
  sheetKey: FlatMasterSheetKey,
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  for (let i = 0; i < rawRows.length; i++) {
    const result = preview[i]
    if (result.action !== 'create' && result.action !== 'update') continue
    const row = flatMasterRowSchema.parse(rawRows[i])
    if (result.action === 'create') {
      await client.query(
        `INSERT INTO commercial_masters (master_key, code, name, description, active, display_order, extra)
         VALUES ($1,$2,$3,$4,$5,$6,'{}')`,
        [sheetKey, row.code, row.name, row.description, row.active, row.displayOrder],
      )
    } else {
      await client.query(
        `UPDATE commercial_masters SET name=$3, description=$4, active=$5, display_order=$6, updated_at=now()
         WHERE master_key=$1 AND lower(trim(code))=lower(trim($2))`,
        [sheetKey, row.code, row.name, row.description, row.active, row.displayOrder],
      )
    }
  }
}

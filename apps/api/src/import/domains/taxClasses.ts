import { z } from 'zod'
import { classifyRows } from '../engine.js'
import type { ImportRowResult } from '../types.js'

const taxClassRowSchema = z.object({
  code: z.string().min(1, 'Code is required').trim(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  ratePct: z.number({ invalid_type_error: 'ratePct must be a number' }),
  active: z.boolean().optional().default(true),
  displayOrder: z.number().optional().default(0),
})
export type TaxClassRow = z.infer<typeof taxClassRowSchema>

interface ExistingTaxClass {
  id: string
  name: string
  description: string
  ratePct: number
  active: boolean
  displayOrder: number
}

async function fetchExisting(client: { query: Function }): Promise<Map<string, ExistingTaxClass>> {
  const result = await client.query(`SELECT * FROM commercial_masters WHERE master_key='taxClasses'`)
  const map = new Map<string, ExistingTaxClass>()
  for (const row of result.rows) {
    map.set(row.code.trim().toUpperCase(), {
      id: row.id, name: row.name, description: row.description,
      ratePct: Number(row.extra.ratePct), active: row.active, displayOrder: row.display_order,
    })
  }
  return map
}

export async function validateTaxClassRows(client: { query: Function }, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const existingByKey = await fetchExisting(client)
  return classifyRows<unknown, ExistingTaxClass>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = taxClassRowSchema.safeParse(raw)
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
      const row = taxClassRowSchema.parse(raw)
      const diffs = []
      if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
      if (row.description !== existing.description) diffs.push({ field: 'description', oldValue: existing.description, newValue: row.description })
      if (row.ratePct !== existing.ratePct) diffs.push({ field: 'ratePct', oldValue: existing.ratePct, newValue: row.ratePct })
      if (row.active !== existing.active) diffs.push({ field: 'active', oldValue: existing.active, newValue: row.active })
      return diffs
    },
    validateRow: (raw) => {
      const parsed = taxClassRowSchema.safeParse(raw)
      if (parsed.success) return []
      return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    },
  })
}

export async function commitTaxClassRows(
  client: { query: Function },
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  for (let i = 0; i < rawRows.length; i++) {
    const result = preview[i]
    if (result.action !== 'create' && result.action !== 'update') continue
    const row = taxClassRowSchema.parse(rawRows[i])
    const extra = JSON.stringify({ ratePct: row.ratePct })
    if (result.action === 'create') {
      await client.query(
        `INSERT INTO commercial_masters (master_key, code, name, description, active, display_order, extra)
         VALUES ('taxClasses',$1,$2,$3,$4,$5,$6)`,
        [row.code, row.name, row.description, row.active, row.displayOrder, extra],
      )
    } else {
      await client.query(
        `UPDATE commercial_masters SET name=$2, description=$3, active=$4, display_order=$5, extra=$6, updated_at=now()
         WHERE master_key='taxClasses' AND lower(trim(code))=lower(trim($1))`,
        [row.code, row.name, row.description, row.active, row.displayOrder, extra],
      )
    }
  }
}

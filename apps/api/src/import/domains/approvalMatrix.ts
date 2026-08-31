import { z } from 'zod'
import { classifyRows } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

const approvalMatrixRowSchema = z.object({
  code: z.string().min(1, 'Code is required').trim(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  minDiscountPct: z.number({ invalid_type_error: 'minDiscountPct must be a number' }),
  maxDiscountPct: z.number({ invalid_type_error: 'maxDiscountPct must be a number' }),
  approvalLevelLabel: z.string().optional().default(''),
  allowAutoApproval: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  displayOrder: z.number().optional().default(0),
})
export type ApprovalMatrixRow = z.infer<typeof approvalMatrixRowSchema>

interface ExistingApprovalBand {
  id: string
  name: string
  description: string
  minDiscountPct: number
  maxDiscountPct: number
  approvalLevelLabel: string
  allowAutoApproval: boolean
  active: boolean
  displayOrder: number
}

/** A band, stripped down to just what the contiguity check needs. */
interface Band {
  minDiscountPct: number
  maxDiscountPct: number
  active: boolean
}

async function fetchExisting(client: { query: Function }): Promise<Map<string, ExistingApprovalBand>> {
  const result = await client.query(`SELECT * FROM commercial_masters WHERE master_key='approvalMatrix'`)
  const map = new Map<string, ExistingApprovalBand>()
  for (const row of result.rows) {
    map.set(row.code.trim().toUpperCase(), {
      id: row.id,
      name: row.name,
      description: row.description,
      minDiscountPct: Number(row.extra.minDiscountPct),
      maxDiscountPct: Number(row.extra.maxDiscountPct),
      approvalLevelLabel: row.extra.approvalLevelLabel ?? '',
      allowAutoApproval: Boolean(row.extra.allowAutoApproval),
      active: row.active,
      displayOrder: row.display_order,
    })
  }
  return map
}

/** Builds the full set of bands that will exist immediately after this batch
 *  commits: existing DB rows whose business key this batch doesn't touch at
 *  all (untouched, so they survive as-is), plus every non-rejected row in
 *  this batch using its *submitted* values (covers create, update, and
 *  unchanged alike — for `unchanged` rows the submitted values equal the
 *  existing ones anyway, so this is equivalent either way). Rejected rows
 *  contribute nothing of their own — whatever existing DB row shares their
 *  key (if any) is unaffected by them and already carried over above. */
function buildResultingBands(
  rawRows: unknown[],
  results: ImportRowResult[],
  existingByKey: Map<string, ExistingApprovalBand>,
): Map<string, Band> {
  const map = new Map<string, Band>()
  for (const [key, existing] of existingByKey) {
    map.set(key, { minDiscountPct: existing.minDiscountPct, maxDiscountPct: existing.maxDiscountPct, active: existing.active })
  }
  rawRows.forEach((raw, index) => {
    const result = results[index]
    if (result.action === 'reject') return
    const parsed = approvalMatrixRowSchema.safeParse(raw)
    if (!parsed.success) return // unreachable: a non-reject row always parsed cleanly
    map.set(result.businessKey, {
      minDiscountPct: parsed.data.minDiscountPct,
      maxDiscountPct: parsed.data.maxDiscountPct,
      active: parsed.data.active,
    })
  })
  return map
}

/** Sorted-by-min, gap/overlap/first-band-at-zero check over only the *active*
 *  bands. Returns the first violation found as a human-readable message
 *  naming the exact gap/overlap range, or null if the active set is
 *  contiguous and gap-free from 0 to its highest Max Discount %. */
function findContiguityViolation(bands: Band[]): string | null {
  const active = bands.filter((b) => b.active).sort((a, b) => a.minDiscountPct - b.minDiscountPct)
  if (active.length === 0) return null

  if (active[0].minDiscountPct !== 0) {
    return `First band's Min Discount % must be 0 (found ${active[0].minDiscountPct}%)`
  }

  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1]
    const curr = active[i]
    if (curr.minDiscountPct > prev.maxDiscountPct) {
      return `Gap between ${prev.maxDiscountPct}% and ${curr.minDiscountPct}% in the approval matrix bands`
    }
    if (curr.minDiscountPct < prev.maxDiscountPct) {
      return `Overlapping bands between ${curr.minDiscountPct}% and ${prev.maxDiscountPct}%`
    }
  }

  return null
}

export async function validateApprovalMatrixRows(client: { query: Function }, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const existingByKey = await fetchExisting(client)
  const results = classifyRows<unknown, ExistingApprovalBand>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = approvalMatrixRowSchema.safeParse(raw)
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
      const row = approvalMatrixRowSchema.parse(raw)
      const diffs: ImportFieldDiff[] = []
      if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
      if (row.description !== existing.description) diffs.push({ field: 'description', oldValue: existing.description, newValue: row.description })
      if (row.minDiscountPct !== existing.minDiscountPct) diffs.push({ field: 'minDiscountPct', oldValue: existing.minDiscountPct, newValue: row.minDiscountPct })
      if (row.maxDiscountPct !== existing.maxDiscountPct) diffs.push({ field: 'maxDiscountPct', oldValue: existing.maxDiscountPct, newValue: row.maxDiscountPct })
      if (row.approvalLevelLabel !== existing.approvalLevelLabel) diffs.push({ field: 'approvalLevelLabel', oldValue: existing.approvalLevelLabel, newValue: row.approvalLevelLabel })
      if (row.allowAutoApproval !== existing.allowAutoApproval) diffs.push({ field: 'allowAutoApproval', oldValue: existing.allowAutoApproval, newValue: row.allowAutoApproval })
      if (row.active !== existing.active) diffs.push({ field: 'active', oldValue: existing.active, newValue: row.active })
      return diffs
    },
    validateRow: (raw) => {
      const parsed = approvalMatrixRowSchema.safeParse(raw)
      if (!parsed.success) return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
      if (parsed.data.minDiscountPct >= parsed.data.maxDiscountPct) {
        return { errors: ['maxDiscountPct must be greater than minDiscountPct'] }
      }
      return { errors: [] }
    },
  })

  // Stage 5, batch-level: the full set of active bands this commit would
  // leave behind must be contiguous and gap-free from 0 to its highest Max
  // Discount %. This is genuinely new validation — commercial.ts does not
  // enforce it today (only an unenforced comment in seed-defaults.ts claims
  // it) — so a violation here rejects the *whole* uploaded batch, not just
  // the row(s) that happen to name the boundary, since no single row is
  // individually "wrong": the batch as a whole doesn't cover the range.
  const violation = findContiguityViolation(Array.from(buildResultingBands(rawRows, results, existingByKey).values()))
  if (violation) {
    return results.map((result) =>
      result.action === 'reject' ? result : { rowNumber: result.rowNumber, businessKey: result.businessKey, action: 'reject', errors: [violation] },
    )
  }

  return results
}

export async function commitApprovalMatrixRows(
  client: { query: Function },
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  for (let i = 0; i < rawRows.length; i++) {
    const result = preview[i]
    if (result.action !== 'create' && result.action !== 'update') continue
    const row = approvalMatrixRowSchema.parse(rawRows[i])
    const extra = JSON.stringify({
      minDiscountPct: row.minDiscountPct,
      maxDiscountPct: row.maxDiscountPct,
      approvalLevelLabel: row.approvalLevelLabel,
      allowAutoApproval: row.allowAutoApproval,
    })
    if (result.action === 'create') {
      await client.query(
        `INSERT INTO commercial_masters (master_key, code, name, description, active, display_order, extra)
         VALUES ('approvalMatrix',$1,$2,$3,$4,$5,$6)`,
        [row.code, row.name, row.description, row.active, row.displayOrder, extra],
      )
    } else {
      await client.query(
        `UPDATE commercial_masters SET name=$2, description=$3, active=$4, display_order=$5, extra=$6, updated_at=now()
         WHERE master_key='approvalMatrix' AND lower(trim(code))=lower(trim($1))`,
        [row.code, row.name, row.description, row.active, row.displayOrder, extra],
      )
    }
  }
}

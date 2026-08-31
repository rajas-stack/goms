import { z } from 'zod'
import { classifyRows } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

const currencyRowSchema = z.object({
  code: z.string().min(1, 'Code is required').trim(),
  name: z.string().min(1, 'Name is required'),
  symbol: z.string().optional().default(''),
  // Currency precision essentially always defaults to 2 (matching almost
  // every real-world currency); an admin uploading a 0- or 3-decimal
  // currency still overrides this explicitly via the column.
  decimalPlaces: z.number({ invalid_type_error: 'decimalPlaces must be a number' }).optional().default(2),
  exchangeRate: z.number({ invalid_type_error: 'exchangeRate must be a number' }),
  isBaseCurrency: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  displayOrder: z.number().optional().default(0),
})
export type CurrencyRow = z.infer<typeof currencyRowSchema>

interface ExistingCurrency {
  id: string
  name: string
  symbol: string
  decimalPlaces: number
  exchangeRate: number
  isBaseCurrency: boolean
  active: boolean
  displayOrder: number
}

async function fetchExisting(client: { query: Function }): Promise<Map<string, ExistingCurrency>> {
  const result = await client.query(`SELECT * FROM commercial_masters WHERE master_key='currencies'`)
  const map = new Map<string, ExistingCurrency>()
  for (const row of result.rows) {
    map.set(row.code.trim().toUpperCase(), {
      id: row.id,
      name: row.name,
      symbol: row.extra.symbol ?? '',
      decimalPlaces: Number(row.extra.decimalPlaces),
      exchangeRate: Number(row.extra.exchangeRate),
      isBaseCurrency: Boolean(row.extra.isBaseCurrency),
      active: row.active,
      displayOrder: row.display_order,
    })
  }
  return map
}

/** Rewrites every non-rejected row's action to 'reject' with the given
 *  reason, leaving already-rejected rows (and their own reasons) untouched.
 *  Used when the exactly-one-base-currency invariant can't be satisfied at
 *  all — the whole batch is unsafe to commit, not just the offending rows. */
function rejectWholeBatch(preview: ImportRowResult[], message: string): ImportRowResult[] {
  return preview.map((result) =>
    result.action === 'reject' ? result : { ...result, action: 'reject', diff: undefined, errors: [message] },
  )
}

/** Enforces "exactly one currency may be Is Base Currency = Y", across the
 *  *whole* classified batch — the currently-committed DB rows this batch
 *  doesn't touch, plus this batch's own create/update/unchanged rows —
 *  mirroring `enforceSingleBaseCurrency`'s single-mutation "last one wins"
 *  behavior in `commercial.ts`, applied to a whole file at once instead of
 *  one row at a time.
 *
 *  Two distinct outcomes:
 *  - The uploaded file itself names more than one row Is Base Currency = Y:
 *    genuinely ambiguous (which one did the admin mean?) — reject the whole
 *    batch, nothing is auto-resolved.
 *  - The file names exactly one new base currency, but an existing DB row
 *    (not present in this upload) is still flagged true: not ambiguous —
 *    same as `commercial.ts`'s create/update mutation, the new one wins and
 *    the old one is implicitly unset. That implicit change is appended to
 *    the preview as its own `update` row (rowNumber 0 — it has no
 *    corresponding sheet row) so the admin sees the side effect before
 *    committing, and `commitCurrencyRows` applies it in the same commit.
 *  - Neither the file nor any untouched existing row is true: reject, since
 *    committing would leave zero base currencies.
 */
function applyBaseCurrencyInvariant(
  preview: ImportRowResult[],
  rawRows: unknown[],
  existingByKey: Map<string, ExistingCurrency>,
): ImportRowResult[] {
  const batchKeys = new Set<string>()
  const trueKeysInBatch: string[] = []

  preview.forEach((result, index) => {
    if (result.action === 'reject') return
    batchKeys.add(result.businessKey)
    const row = currencyRowSchema.parse(rawRows[index])
    if (row.isBaseCurrency) trueKeysInBatch.push(result.businessKey)
  })

  if (trueKeysInBatch.length > 1) {
    return rejectWholeBatch(
      preview,
      'More than one row is marked Is Base Currency = Y; exactly one currency may be the base currency.',
    )
  }

  const untouchedTrueKeys = Array.from(existingByKey.entries())
    .filter(([key, existing]) => existing.isBaseCurrency && !batchKeys.has(key))
    .map(([key]) => key)

  const totalTrue = trueKeysInBatch.length + untouchedTrueKeys.length
  if (totalTrue === 0) {
    return rejectWholeBatch(preview, 'At least one currency must be marked Is Base Currency = Y.')
  }

  if (trueKeysInBatch.length === 1 && untouchedTrueKeys.length > 0) {
    for (const key of untouchedTrueKeys) {
      preview.push({
        rowNumber: 0,
        businessKey: key,
        action: 'update',
        diff: [{ field: 'isBaseCurrency', oldValue: true, newValue: false }],
        errors: [],
      })
    }
  }

  return preview
}

export async function validateCurrencyRows(client: { query: Function }, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const existingByKey = await fetchExisting(client)
  const preview = classifyRows<unknown, ExistingCurrency>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = currencyRowSchema.safeParse(raw)
      if (parsed.success) return parsed.data.code.toUpperCase()
      if (typeof raw !== 'object' || raw === null) return `__row_${index}__`
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
      const row = currencyRowSchema.parse(raw)
      const diffs: ImportFieldDiff[] = []
      if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
      if (row.symbol !== existing.symbol) diffs.push({ field: 'symbol', oldValue: existing.symbol, newValue: row.symbol })
      if (row.decimalPlaces !== existing.decimalPlaces) diffs.push({ field: 'decimalPlaces', oldValue: existing.decimalPlaces, newValue: row.decimalPlaces })
      if (row.exchangeRate !== existing.exchangeRate) diffs.push({ field: 'exchangeRate', oldValue: existing.exchangeRate, newValue: row.exchangeRate })
      if (row.isBaseCurrency !== existing.isBaseCurrency) diffs.push({ field: 'isBaseCurrency', oldValue: existing.isBaseCurrency, newValue: row.isBaseCurrency })
      if (row.active !== existing.active) diffs.push({ field: 'active', oldValue: existing.active, newValue: row.active })
      if (row.displayOrder !== existing.displayOrder) diffs.push({ field: 'displayOrder', oldValue: existing.displayOrder, newValue: row.displayOrder })
      return diffs
    },
    validateRow: (raw) => {
      const parsed = currencyRowSchema.safeParse(raw)
      if (parsed.success) return { errors: [] }
      return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
    },
  })

  return applyBaseCurrencyInvariant(preview, rawRows, existingByKey)
}

export async function commitCurrencyRows(
  client: { query: Function },
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  for (let i = 0; i < rawRows.length; i++) {
    const result = preview[i]
    if (!result || (result.action !== 'create' && result.action !== 'update')) continue
    const row = currencyRowSchema.parse(rawRows[i])
    const extra = JSON.stringify({
      symbol: row.symbol,
      decimalPlaces: row.decimalPlaces,
      exchangeRate: row.exchangeRate,
      isBaseCurrency: row.isBaseCurrency,
    })
    if (result.action === 'create') {
      await client.query(
        `INSERT INTO commercial_masters (master_key, code, name, active, display_order, extra)
         VALUES ('currencies',$1,$2,$3,$4,$5)`,
        [row.code, row.name, row.active, row.displayOrder, extra],
      )
    } else {
      await client.query(
        `UPDATE commercial_masters SET name=$2, active=$3, display_order=$4, extra=$5, updated_at=now()
         WHERE master_key='currencies' AND lower(trim(code))=lower(trim($1))`,
        [row.code, row.name, row.active, row.displayOrder, extra],
      )
    }
  }

  // Implicit rows appended beyond rawRows.length by applyBaseCurrencyInvariant:
  // an existing base-currency row that wasn't in this upload at all, but
  // whose flag must still be unset in the same commit that sets the new one,
  // so exactly one base currency survives.
  for (let i = rawRows.length; i < preview.length; i++) {
    const result = preview[i]
    if (result.action !== 'update') continue
    await client.query(
      `UPDATE commercial_masters SET extra = extra || '{"isBaseCurrency": false}'::jsonb, updated_at=now()
       WHERE master_key='currencies' AND lower(trim(code))=lower(trim($1))`,
      [result.businessKey],
    )
  }
}

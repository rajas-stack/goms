import { createHash } from 'node:crypto'
import type { ImportDomainKey, ImportFieldDiff, ImportRowResult, ImportSummary } from './types.js'

/** Bounded so a single request can't hold the whole event loop hostage
 *  parsing/validating an unbounded spreadsheet — matches the "file/row/JSON
 *  size limits" requirement. An admin with more rows splits the file. */
export const MAX_IMPORT_ROWS = 5000

export function classifyRows<TRow, TExisting>(opts: {
  rows: TRow[]
  /** `index` lets a domain mint a per-row synthetic key (e.g. when the
   *  real key field is blank/invalid) so two equally-invalid rows never
   *  falsely collide as "duplicates" of each other — each still reaches
   *  `validateRow` independently and gets its own specific error. Only
   *  return `null` when no key — real or synthetic — can be derived at all. */
  getBusinessKey: (row: TRow, index: number) => string | null
  existingByKey: Map<string, TExisting>
  diffFields: (row: TRow, existing: TExisting) => ImportFieldDiff[]
  validateRow: (row: TRow, index: number) => string[]
}): ImportRowResult[] {
  const { rows, getBusinessKey, existingByKey, diffFields, validateRow } = opts
  const seen = new Map<string, number>() // businessKey -> first row number that claimed it
  const results: ImportRowResult[] = []

  rows.forEach((row, index) => {
    const rowNumber = index + 1
    const businessKey = getBusinessKey(row, index)

    if (businessKey === null) {
      results.push({ rowNumber, businessKey: '', action: 'reject', errors: ['business key could not be determined for this row'] })
      return
    }

    const firstSeenAt = seen.get(businessKey)
    if (firstSeenAt !== undefined) {
      results.push({ rowNumber, businessKey, action: 'reject', errors: [`duplicate of row ${firstSeenAt} in this file`] })
      return
    }
    seen.set(businessKey, rowNumber)

    const errors = validateRow(row, index)
    if (errors.length > 0) {
      results.push({ rowNumber, businessKey, action: 'reject', errors })
      return
    }

    const existing = existingByKey.get(businessKey)
    if (!existing) {
      results.push({ rowNumber, businessKey, action: 'create', errors: [] })
      return
    }

    const diff = diffFields(row, existing)
    results.push(
      diff.length === 0
        ? { rowNumber, businessKey, action: 'unchanged', errors: [] }
        : { rowNumber, businessKey, action: 'update', diff, errors: [] },
    )
  })

  return results
}

export function summarize(rows: ImportRowResult[]): ImportSummary {
  return {
    toCreate: rows.filter((r) => r.action === 'create').length,
    toUpdate: rows.filter((r) => r.action === 'update').length,
    unchanged: rows.filter((r) => r.action === 'unchanged').length,
    rejected: rows.filter((r) => r.action === 'reject').length,
    total: rows.length,
  }
}

export function computeCommitToken(domain: ImportDomainKey, rows: unknown[]): string {
  return createHash('sha256').update(domain).update(JSON.stringify(rows)).digest('hex')
}

export function verifyCommitToken(domain: ImportDomainKey, rows: unknown[], token: string): boolean {
  return computeCommitToken(domain, rows) === token
}

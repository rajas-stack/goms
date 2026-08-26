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

/** Resolves self-referencing tree structures (Organization Hierarchy's
 *  Parent Code, Employees'/Sales Postings' Manager code, Commercial Masters
 *  Catalog's Parent Code chain) where one row in an uploaded file can name
 *  another row *earlier or later in the same file* as its parent. Reapplies
 *  the same "resolve what you can now, defer what you can't yet, retry until
 *  nothing changes" two-pass algorithm `gov-hierarchy.ts`'s `buildOrgTree`
 *  already uses for its `pendingManagers` list, generically instead of
 *  copy-pasted per domain. A row is "resolved" once its own key has been
 *  added to the resolved set — either because it has no parent, or because
 *  its parent was already resolved (in the database or earlier in this same
 *  pass). Anything left in `unresolved` after the loop stalls either names a
 *  parent that exists nowhere, or is part of a genuine cycle — both are
 *  reported the same way (as unresolved indices) since the caller turns
 *  each into its own "no such parent code" rejection either way. */
export function resolveTreeReferences<TRow>(opts: {
  rows: TRow[]
  getOwnKey: (row: TRow) => string
  getParentKey: (row: TRow) => string | null
  existingKeys: Set<string>
}): { unresolved: number[] } {
  const { rows, getOwnKey, getParentKey, existingKeys } = opts
  const resolvedKeys = new Set(existingKeys)
  const pending = new Set(rows.map((_, i) => i))

  let progressed = true
  while (progressed && pending.size > 0) {
    progressed = false
    for (const index of Array.from(pending)) {
      const parentKey = getParentKey(rows[index])
      if (parentKey === null || resolvedKeys.has(parentKey)) {
        resolvedKeys.add(getOwnKey(rows[index]))
        pending.delete(index)
        progressed = true
      }
    }
  }

  return { unresolved: Array.from(pending).sort((a, b) => a - b) }
}

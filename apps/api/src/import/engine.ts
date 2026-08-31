import { createHash } from 'node:crypto'
import type { FuzzyCandidate, ImportDomainKey, ImportFieldDiff, ImportRowResult, ImportSummary } from './types.js'

/** Bounded so a single request can't hold the whole event loop hostage
 *  parsing/validating an unbounded spreadsheet — matches the "file/row/JSON
 *  size limits" requirement. An admin with more rows splits the file. */
export const MAX_IMPORT_ROWS = 5000

export const MIN_FUZZY_SIMILARITY = 0.6
const MAX_CANDIDATES = 3

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().split(/\s+/).sort().join(' ')
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function similarityRatio(a: string, b: string): number {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(na, nb) / maxLen
}

export function findFuzzyCandidates(needle: string, haystack: Iterable<string>): FuzzyCandidate[] {
  const scored: FuzzyCandidate[] = []
  for (const key of haystack) {
    const score = similarityRatio(needle, key)
    if (score >= MIN_FUZZY_SIMILARITY) scored.push({ key, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES)
}

export interface RowValidation {
  errors: string[]
  needsReview?: boolean
  candidates?: FuzzyCandidate[]
}

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
  validateRow: (row: TRow, index: number) => RowValidation
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

    const validation = validateRow(row, index)
    if (validation.errors.length > 0) {
      results.push({
        rowNumber, businessKey,
        action: validation.needsReview ? 'needs-review' : 'reject',
        candidates: validation.candidates,
        errors: validation.errors,
      })
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
    needsReview: rows.filter((r) => r.action === 'needs-review').length,
    rejected: rows.filter((r) => r.action === 'reject').length,
    total: rows.length,
  }
}

// `rows` is `unknown`, not `unknown[]` — most domains submit a flat array,
// but the multi-sheet domains (Commercial Masters Flat/Catalog, Sales
// Roster) submit a `{ sheetName: rows[] }` dictionary instead. Either shape
// hashes fine; only the router cares about the distinction.
export function computeCommitToken(domain: ImportDomainKey, rows: unknown): string {
  return createHash('sha256').update(domain).update(JSON.stringify(rows)).digest('hex')
}

export function verifyCommitToken(domain: ImportDomainKey, rows: unknown, token: string): boolean {
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

import type { ImportDomainKey, ImportRowResult, ImportSummary } from '../types.js'

/** Mirrors adminImport.ts's existing per-domain rows shape exactly: most
 *  domains submit a flat array; the 3 multi-sheet domains
 *  (commercialMastersFlat, commercialMastersCatalog, salesRoster) submit a
 *  `{ sheetKey: rows[] }` dictionary. Reused as-is so every existing
 *  domain adapter needs zero change to its own input shape. */
export type SessionDomainRows = unknown[] | Record<string, unknown[]>

export interface SessionValidateInput {
  domains: Partial<Record<ImportDomainKey, SessionDomainRows>>
}

export interface SessionDomainPreview {
  domain: ImportDomainKey
  /** This domain's own preview shape — a flat ImportRowResult[] for
   *  single-sheet domains, or the `{ sheetKey: ImportRowResult[] }` /
   *  `{persons,postings}` / `{verticals,products,modules,features}` shape
   *  for the 3 multi-sheet domains — passed through unflattened so the
   *  frontend can still group by sheet exactly like the old per-domain
   *  wizard did (api.ts's existing flattenPreview keeps working unchanged). */
  preview: unknown
}

export interface SessionValidateOutput {
  domainOrder: ImportDomainKey[]
  previews: SessionDomainPreview[]
  /** Aggregated across every domain in the session. */
  summary: ImportSummary
  sessionCommitToken: string
}

export interface ExcludedRow {
  domain: ImportDomainKey
  rowNumber: number
  /** Human-readable sheet label for audit-trail display only (e.g. "Sales
   *  Persons") — NOT what the server matches on; some adapters (salesRoster)
   *  set this to a display title, others (catalog/flat) don't set it at
   *  all. See `sheetKey` for the field that actually locates the row. */
  sheet?: string
  /** The multi-sheet domain's own internal key ('persons', 'verticals',
   *  'skuCategories', ...) that `rowNumber` is positional within — undefined
   *  for a single-array domain. This, not `sheet`, is what the server uses
   *  to find and remove the right row (Task 7's `runSessionCommit`). */
  sheetKey?: string
  businessKey: string
  /** Free-text reason the admin gave in the exclude-confirm dialog (design
   *  spec §7's "explicit 'exclude this row' action with a confirm dialog"). */
  reason: string
}

export interface SessionCommitInput {
  /** The EXACT SAME domains object submitted to the preceding validate call
   *  — untrimmed. Rows to exclude are named in `excludedRows` below by their
   *  position in THIS original array/dict, not removed from it here. The
   *  server (Task 7) does the removal itself, after cross-checking that each
   *  named exclusion really is a needs-review/reject row.
   *
   *  This is deliberate, not an oversight: computing `sessionCommitToken`
   *  from the untrimmed payload and requiring the caller to keep resending
   *  that same untrimmed payload means the staleness check stays a single
   *  flat hash comparison — no separate bookkeeping for "did the caller's
   *  trimming match what was validated." An earlier version of this design
   *  required the caller to pre-trim `domains` before commit while reusing
   *  the token from the untrimmed validate call — the hash computed from
   *  the (now-trimmed) `domains` then never matched, and every session with
   *  an exclusion was wrongly rejected as stale. */
  domains: Partial<Record<ImportDomainKey, SessionDomainRows>>
  sessionCommitToken: string
  excludedRows: ExcludedRow[]
}

export interface SessionCommitOutput {
  sessionId: string
  summary: ImportSummary
}

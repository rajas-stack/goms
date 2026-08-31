import { randomUUID, createHash } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import type { Pool } from 'pg'
import { ADAPTERS, requireWired } from './adapters.js'
import { topologicalOrder } from './dependencyGraph.js'
import { summarize } from '../engine.js'
import { recordImportRun } from '../auditLog.js'
import type { ImportDomainKey, ImportRowResult } from '../types.js'
import type {
  SessionValidateInput, SessionValidateOutput, SessionDomainPreview,
  SessionCommitInput, SessionCommitOutput, SessionDomainRows, ExcludedRow,
} from './types.js'

function computeSessionCommitToken(
  domainOrder: ImportDomainKey[],
  domains: Partial<Record<ImportDomainKey, SessionDomainRows>>,
): string {
  const hash = createHash('sha256')
  for (const domain of domainOrder) hash.update(domain).update(JSON.stringify(domains[domain] ?? null))
  return hash.digest('hex')
}

function flattenAll(previews: SessionDomainPreview[]): ImportRowResult[] {
  return previews.flatMap(({ domain, preview }) => ADAPTERS[domain]!.flatten(preview))
}

/** Nothing here is ever written for real — every domain's real commit() is
 *  called only so the NEXT domain's own live-DB lookups see this domain's
 *  provisional rows (design spec §6.1). Always rolled back, success or
 *  failure, since this transaction exists purely to build the combined
 *  cross-domain preview. */
export async function runSessionValidate(pool: Pool, input: SessionValidateInput): Promise<SessionValidateOutput> {
  const domainOrder = topologicalOrder(Object.keys(input.domains) as ImportDomainKey[])
  const client = await pool.connect()
  const previews: SessionDomainPreview[] = []
  try {
    await client.query('BEGIN')
    for (const domain of domainOrder) {
      const rows = input.domains[domain]!
      const adapter = requireWired(domain)
      const preview = await adapter.validate(client, rows)
      previews.push({ domain, preview })
      await adapter.commit(client, rows, preview)
    }
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
  return {
    domainOrder,
    previews,
    summary: summarize(flattenAll(previews)),
    sessionCommitToken: computeSessionCommitToken(domainOrder, input.domains),
  }
}

/** One domain's raw (unflattened) preview or rows, narrowed to one sheet.
 *  `sheetKey` is undefined for a single-array domain, or the multi-sheet
 *  domain's own internal key ('persons', 'verticals', 'skuCategories', ...)
 *  otherwise — NEVER the human `.sheet` label some adapters additionally
 *  set on each row (salesRoster sets 'Sales Persons'/'Postings'; catalog
 *  and flat masters set nothing at all) — matching on that would silently
 *  fail for salesRoster and always-fail for catalog/flat. */
function rowsAt(container: unknown, sheetKey: string | undefined): unknown[] {
  if (Array.isArray(container)) return container
  const dict = container as Record<string, unknown[]>
  return sheetKey ? (dict[sheetKey] ?? []) : []
}

function withRowsAt(container: SessionDomainRows, sheetKey: string | undefined, replacement: unknown[]): SessionDomainRows {
  if (Array.isArray(container)) return replacement
  return { ...(container as Record<string, unknown[]>), [sheetKey!]: replacement }
}

/** Removes exactly the rows named in `excludedRows` from `originalRows`,
 *  after confirming each one really is a needs-review/reject row at that
 *  position in `originalPreview` (the fresh, unflattened preview of the
 *  UNTRIMMED rows) — a client can't "exclude" a row that's actually fine to
 *  dodge the commit gate, and a stale/mismatched exclusion is rejected
 *  outright rather than silently ignored. Every index for one sheet is
 *  collected into a Set before any filtering happens, so excluding two rows
 *  from the same sheet never shifts the other's position out from under it
 *  mid-removal (see this task's design note). */
function applyExclusions(
  domain: ImportDomainKey,
  originalRows: SessionDomainRows,
  originalPreview: unknown,
  excludedForDomain: ExcludedRow[],
): SessionDomainRows {
  const bySheetKey = new Map<string | undefined, Set<number>>()
  for (const excluded of excludedForDomain) {
    const previewRows = rowsAt(originalPreview, excluded.sheetKey) as ImportRowResult[]
    const matched = previewRows[excluded.rowNumber - 1]
    if (!matched || matched.businessKey !== excluded.businessKey || (matched.action !== 'needs-review' && matched.action !== 'reject')) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Excluded row ${excluded.rowNumber} in "${domain}"${excluded.sheetKey ? `/${excluded.sheetKey}` : ''} does not match a needs-review/reject row in the current preview — re-validate before committing.`,
      })
    }
    const set = bySheetKey.get(excluded.sheetKey) ?? new Set<number>()
    set.add(excluded.rowNumber - 1)
    bySheetKey.set(excluded.sheetKey, set)
  }

  let rows = originalRows
  for (const [sheetKey, indexes] of bySheetKey) {
    const kept = rowsAt(rows, sheetKey).filter((_, i) => !indexes.has(i))
    rows = withRowsAt(rows, sheetKey, kept)
  }
  return rows
}

/** Replays the identical loop for real: re-validates every domain against
 *  live state, refuses to touch any domain's commit() while any row in the
 *  session remains needs-review/reject (the session-level fix for the
 *  per-adapter silent create/update-only filtering — gap #1), and commits
 *  the whole transaction only once every domain has passed.
 *
 *  `input.domains` is always the SAME untrimmed payload `sessionCommitToken`
 *  was computed from (see Task 6's `SessionCommitInput` doc-comment and
 *  this task's design note) — exclusions are applied here, per-domain,
 *  never by the caller pre-trimming the payload it sends. */
export async function runSessionCommit(pool: Pool, input: SessionCommitInput): Promise<SessionCommitOutput> {
  const domainOrder = topologicalOrder(Object.keys(input.domains) as ImportDomainKey[])
  if (computeSessionCommitToken(domainOrder, input.domains) !== input.sessionCommitToken) {
    throw new TRPCError({ code: 'CONFLICT', message: 'This data has changed since it was previewed. Please re-validate before committing.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const previews: SessionDomainPreview[] = []
    for (const domain of domainOrder) {
      const originalRows = input.domains[domain]!
      const adapter = requireWired(domain)
      const excludedForDomain = input.excludedRows.filter((r) => r.domain === domain)

      // Fresh preview of the ORIGINAL, untrimmed rows — used only to
      // validate the exclusion requests themselves (see applyExclusions).
      const originalPreview = await adapter.validate(client, originalRows)
      const trimmedRows = applyExclusions(domain, originalRows, originalPreview, excludedForDomain)

      const freshPreview = await adapter.validate(client, trimmedRows)
      const flat = adapter.flatten(freshPreview)
      const blocking = flat.filter((r: ImportRowResult) => r.action === 'needs-review' || r.action === 'reject')
      if (blocking.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot commit while ${blocking.length} row(s) in "${domain}" are unresolved or rejected. Resolve or explicitly exclude them and re-validate.`,
        })
      }
      await adapter.commit(client, trimmedRows, freshPreview)
      previews.push({ domain, preview: freshPreview })
    }

    const sessionId = randomUUID()
    for (const { domain, preview } of previews) {
      const flat = ADAPTERS[domain]!.flatten(preview)
      const excludedForDomain = input.excludedRows.filter((r) => r.domain === domain)
      await recordImportRun(client, sessionId, domain, summarize(flat), flat, excludedForDomain)
    }

    await client.query('COMMIT')
    return { sessionId, summary: summarize(flattenAll(previews)) }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

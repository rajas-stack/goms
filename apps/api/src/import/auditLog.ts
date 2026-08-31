import { pool } from '../db.js'
import type { ImportRowResult, ImportSummary } from './types.js'
import type { ExcludedRow } from './session/types.js'

export async function recordImportRun(
  client: { query: Function },
  sessionId: string,
  domain: string,
  summary: ImportSummary,
  rejectedRows: ImportRowResult[],
  excludedRows: ExcludedRow[],
): Promise<void> {
  await client.query(
    `INSERT INTO admin_import_runs (session_id, domain, summary, rejected_rows, excluded_rows) VALUES ($1,$2,$3,$4,$5)`,
    [
      sessionId, domain, JSON.stringify(summary),
      JSON.stringify(rejectedRows.filter((r) => r.action === 'reject')),
      JSON.stringify(excludedRows),
    ],
  )
}

export interface ImportHistoryEntry {
  id: string
  sessionId: string | null
  domain: string
  summary: ImportSummary
  rejectedRowCount: number
  excludedRows: ExcludedRow[]
  committedAt: string
}

function toEntry(r: any): ImportHistoryEntry {
  return {
    id: r.id, sessionId: r.session_id, domain: r.domain, summary: r.summary,
    rejectedRowCount: r.rejected_row_count, excludedRows: r.excluded_rows, committedAt: r.committed_at,
  }
}

export async function listImportHistory(domain: string): Promise<ImportHistoryEntry[]> {
  const result = await pool.query(
    `SELECT id, session_id, domain, summary, jsonb_array_length(rejected_rows) AS rejected_row_count, excluded_rows, committed_at
     FROM admin_import_runs WHERE domain=$1 ORDER BY committed_at DESC LIMIT 50`,
    [domain],
  )
  return result.rows.map(toEntry)
}

/** Every domain committed together under one session (Task 7's orchestrator
 *  writes one row per domain, sharing this id) — the frontend's post-commit
 *  summary (Task 21) uses this instead of listImportHistory so a 5-domain
 *  session shows as one grouped result, not 5 unrelated history rows. */
export async function listSessionHistory(sessionId: string): Promise<ImportHistoryEntry[]> {
  const result = await pool.query(
    `SELECT id, session_id, domain, summary, jsonb_array_length(rejected_rows) AS rejected_row_count, excluded_rows, committed_at
     FROM admin_import_runs WHERE session_id=$1 ORDER BY domain ASC`,
    [sessionId],
  )
  return result.rows.map(toEntry)
}

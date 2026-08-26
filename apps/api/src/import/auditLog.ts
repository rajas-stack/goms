import { pool } from '../db.js'
import type { ImportRowResult, ImportSummary } from './types.js'

export async function recordImportRun(
  client: { query: Function },
  domain: string,
  summary: ImportSummary,
  rejectedRows: ImportRowResult[],
): Promise<void> {
  await client.query(
    `INSERT INTO admin_import_runs (domain, summary, rejected_rows) VALUES ($1,$2,$3)`,
    [domain, JSON.stringify(summary), JSON.stringify(rejectedRows.filter((r) => r.action === 'reject'))],
  )
}

export interface ImportHistoryEntry {
  id: string
  summary: ImportSummary
  rejectedRowCount: number
  committedAt: string
}

export async function listImportHistory(domain: string): Promise<ImportHistoryEntry[]> {
  const result = await pool.query(
    `SELECT id, summary, jsonb_array_length(rejected_rows) AS rejected_row_count, committed_at
     FROM admin_import_runs WHERE domain=$1 ORDER BY committed_at DESC LIMIT 50`,
    [domain],
  )
  return result.rows.map((r) => ({
    id: r.id, summary: r.summary, rejectedRowCount: r.rejected_row_count, committedAt: r.committed_at,
  }))
}

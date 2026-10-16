import type { InsightCorrigendumRow, InsightReport, InsightVisual, ReportFilters, ReportWidget, VisualSpec } from '@goms/domain'
import { pool } from '../db.js'

/** SQL for Insights Studio. Every list / read is scoped to rows the caller owns or that are shared; every write is
 *  addressed by id and re-checked by the router (owner, or a shared-row manager). */

const iso = (value: unknown) => new Date(value as string).toISOString()

export function toVisual(row: any): InsightVisual {
  return {
    id: String(row.id), name: row.name, description: row.description ?? '', spec: row.spec as VisualSpec,
    ownerEmail: row.owner_email, shared: !!row.shared, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  }
}

export function toReport(row: any): InsightReport {
  return {
    id: String(row.id), name: row.name, description: row.description ?? '', widgets: (row.layout ?? []) as ReportWidget[],
    filters: (row.filters ?? { period: { kind: 'all' } }) as ReportFilters, ownerEmail: row.owner_email, shared: !!row.shared,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  }
}

export type StudioTable = 'insight_visuals' | 'insight_reports'

const VISIBLE = '(lower(owner_email) = $1 OR shared)'

export async function listVisible(table: StudioTable, email: string): Promise<any[]> {
  return (await pool.query(`SELECT * FROM ${table} WHERE ${VISIBLE} ORDER BY lower(name), created_at, insert_seq`, [email])).rows
}

export async function getVisible(table: StudioTable, id: string, email: string): Promise<any | null> {
  return (await pool.query(`SELECT * FROM ${table} WHERE id = $2 AND ${VISIBLE}`, [email, id])).rows[0] ?? null
}

/** Ids of saved visuals the caller may place on a report (own or shared). */
export async function visibleVisualIds(email: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = (await pool.query(`SELECT id FROM insight_visuals WHERE id = ANY($2::uuid[]) AND ${VISIBLE}`, [email, ids])).rows
  return new Set(rows.map((r) => String(r.id)))
}

export async function insertVisual(email: string, v: { name: string; description: string; spec: VisualSpec; shared: boolean }) {
  return (await pool.query(
    'INSERT INTO insight_visuals (name, description, spec, owner_email, shared) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [v.name, v.description, JSON.stringify(v.spec), email, v.shared],
  )).rows[0]
}

export async function updateVisualRow(id: string, v: { name: string; description: string; spec: VisualSpec; shared: boolean }) {
  return (await pool.query(
    'UPDATE insight_visuals SET name=$1, description=$2, spec=$3, shared=$4, updated_at=now() WHERE id=$5 RETURNING *',
    [v.name, v.description, JSON.stringify(v.spec), v.shared, id],
  )).rows[0] ?? null
}

export async function insertReport(email: string, r: { name: string; description: string; widgets: ReportWidget[]; filters: ReportFilters; shared: boolean }) {
  return (await pool.query(
    'INSERT INTO insight_reports (name, description, layout, filters, owner_email, shared) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [r.name, r.description, JSON.stringify(r.widgets), JSON.stringify(r.filters), email, r.shared],
  )).rows[0]
}

export async function updateReportRow(id: string, r: { name: string; description: string; widgets: ReportWidget[]; filters: ReportFilters; shared: boolean }) {
  return (await pool.query(
    'UPDATE insight_reports SET name=$1, description=$2, layout=$3, filters=$4, shared=$5, updated_at=now() WHERE id=$6 RETURNING *',
    [r.name, r.description, JSON.stringify(r.widgets), JSON.stringify(r.filters), r.shared, id],
  )).rows[0] ?? null
}

export async function deleteRow(table: StudioTable, id: string): Promise<boolean> {
  return ((await pool.query(`DELETE FROM ${table} WHERE id=$1`, [id])).rowCount ?? 0) > 0
}

/** Every corrigendum register row with its bid's code, sheet and opportunity name and the clause-change counts —
 *  one query instead of one per bid. The RBAC mask filters rows by sheet like the bid grid. */
export async function listCorrigendaForInsights(): Promise<InsightCorrigendumRow[]> {
  const rows = (await pool.query(`
    SELECT c.id, c.bid_id, c.corrigendum_number, c.detected_at, c.published_date, c.impact_level, c.review_status,
           c.technical_impact, c.commercial_impact, c.submission_date_impact, b.bid_code, b.sheet, o.opportunity_name,
           count(ch.id)::int AS change_count, (count(ch.id) FILTER (WHERE ch.decision = 'pending'))::int AS pending_changes
      FROM bid_corrigenda c
      JOIN bids b ON b.id = c.bid_id
      JOIN opportunities o ON o.id = b.opportunity_id
      LEFT JOIN bid_corrigendum_changes ch ON ch.corrigendum_id = c.id
     GROUP BY c.id, b.bid_code, b.sheet, o.opportunity_name
     ORDER BY c.detected_at, c.corrigendum_number`)).rows
  return rows.map((r) => ({
    id: String(r.id), bidId: String(r.bid_id), bidCode: r.bid_code ?? '', sheet: r.sheet, opportunityName: r.opportunity_name ?? '',
    corrigendumNumber: Number(r.corrigendum_number), status: r.pending_changes > 0 ? 'pending_review' : 'reviewed',
    reviewStatus: r.review_status ?? 'pending', impactLevel: r.impact_level ?? 'medium',
    technicalImpact: !!r.technical_impact, commercialImpact: !!r.commercial_impact, submissionDateImpact: !!r.submission_date_impact,
    changeCount: r.change_count, pendingChanges: r.pending_changes,
    detectedAt: r.detected_at ? iso(r.detected_at) : null, publishedDate: r.published_date ? String(r.published_date instanceof Date ? r.published_date.toISOString() : r.published_date).slice(0, 10) : null,
  }))
}

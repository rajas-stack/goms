// Shared sink for every module's field-level change history — extracted
// from commercial.ts (spec §16) so Bid Tracker can log into the same
// generic commercial_audit_logs table (entity_type/entity_id/field/old/new/
// reason/action/changed_at/changed_by — already generic despite its name)
// without a second, duplicate table. commercial.ts's own `commercial.
// auditLogs.list` procedure keeps its exact existing route/input/output
// shape by calling `listAuditLogs` from here — zero behavior change for its
// existing consumer, AuditLog.tsx in commercial-calculator.
import { pool } from '../db.js'

export interface AuditLogEntry {
  entityType: string
  entityId: string
  field: string
  oldValue: string
  newValue: string
  reason: string
  action: string
  changedBy?: string | null
}

export async function writeAuditLog(client: { query: (sql: string, params?: unknown[]) => Promise<any> }, entry: AuditLogEntry) {
  await client.query(
    `INSERT INTO commercial_audit_logs (entity_type, entity_id, field, old_value, new_value, reason, action, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [entry.entityType, entry.entityId, entry.field, entry.oldValue, entry.newValue, entry.reason, entry.action, entry.changedBy ?? null],
  )
}

export function toAuditLog(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, field: row.field,
    oldValue: row.old_value, newValue: row.new_value, reason: row.reason, action: row.action,
    changedAt: row.changed_at.toISOString(), changedBy: row.changed_by,
  }
}

export async function listAuditLogs(filter?: { entityType?: string; entityId?: string }) {
  const conditions: string[] = []
  const params: any[] = []
  if (filter?.entityType) { params.push(filter.entityType); conditions.push(`entity_type=$${params.length}`) }
  if (filter?.entityId) { params.push(filter.entityId); conditions.push(`entity_id=$${params.length}`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(`SELECT * FROM commercial_audit_logs ${where} ORDER BY changed_at DESC`, params)
  return result.rows.map(toAuditLog)
}

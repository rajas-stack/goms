import { supabase } from './client'
import type { Database } from './database.types'
import type { CommercialAuditLog } from '@/modules/commercial-calculator/types'

type AuditLogRow = Database['public']['Tables']['audit_logs']['Row']
type PostgrestErrorLike = { code?: string; message: string }

function toAuditLog(row: AuditLogRow): CommercialAuditLog {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, field: row.field,
    oldValue: row.old_value, newValue: row.new_value, reason: row.reason, action: row.action,
    changedAt: row.changed_at, changedBy: row.changed_by,
  }
}

export async function listAuditLogs(filter?: { entityType?: string; entityId?: string }): Promise<CommercialAuditLog[]> {
  let query = supabase.from('audit_logs').select('*')
  if (filter?.entityType) query = query.eq('entity_type', filter.entityType)
  if (filter?.entityId) query = query.eq('entity_id', filter.entityId)
  const { data, error } = await query.order('changed_at', { ascending: false })
  if (error) throw error
  return data.map(toAuditLog)
}

/** Postgres SQLSTATE 23502 (not_null_violation) / 23514 (check_violation) are
 *  the only constraints `audit_logs` actually has beyond its defaults — this
 *  turns either into a message an end user can act on instead of a raw
 *  PostgrestError leaking column/constraint names into the UI. */
function translateAuditWriteError(error: PostgrestErrorLike): Error {
  if (error.code === '23502') return new Error('Could not record this change to the audit trail — a required audit field was missing.')
  if (error.code === '23514') return new Error('Could not record this change to the audit trail — the audit entry failed a data validation rule.')
  return new Error(`Could not record this change to the audit trail: ${error.message}`)
}

/** Shared, cross-module audit write (spec §4/§8 Phase 5) — replaces the old
 *  `recordCommercialAuditLogEntry` Repository bridge (in-memory/repository.ts,
 *  Phase 3), which existed only until this table itself was Supabase-backed. */
export async function recordAuditLogEntry(entry: Omit<CommercialAuditLog, 'id' | 'changedAt'>): Promise<void> {
  const row = {
    entity_type: entry.entityType, entity_id: entry.entityId, field: entry.field,
    old_value: entry.oldValue, new_value: entry.newValue, reason: entry.reason,
    action: entry.action, changed_by: entry.changedBy,
  }
  const { error } = await supabase.from('audit_logs').insert(row)
  if (error) throw translateAuditWriteError(error)
}

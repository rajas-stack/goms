import { fieldValueForMilestone, milestoneStateForField, timelineSyncForField, timelineSyncForMilestone, type CustomFieldType } from '@goms/domain'
import { customValueColumns } from './customFieldValues.js'
import { writeAuditLog } from './auditLog.js'

type Client = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }
const today = () => new Date().toISOString().slice(0, 10)

/** A Live Bids field linked to a Timeline phase (BID_TIMELINE_SYNC) changed: move the phase's milestone. */
export async function syncFieldToMilestone(client: Client, bidId: string, fieldKey: string, value: unknown, actor: string | null | undefined) {
  const sync = timelineSyncForField(fieldKey)
  if (!sync) return
  const current = (await client.query('SELECT id, status, due_at FROM bid_milestones WHERE bid_id=$1 AND key=$2 FOR UPDATE', [bidId, sync.milestoneKey])).rows[0]
  const next = milestoneStateForField(sync, value, today(), current?.due_at ? String(current.due_at).slice(0, 10) : null)
  if (!current) {
    if (next.status !== 'completed') return
    await client.query(`INSERT INTO bid_milestones (bid_id, milestone_type, key, label, due_at, status) VALUES ($1,'timeline',$2,$3,$4,'completed')`,
      [bidId, sync.milestoneKey, sync.label, next.dueAt])
  } else if (current.status !== next.status || String(current.due_at ?? '').slice(0, 10) !== String(next.dueAt ?? '').slice(0, 10)) {
    await client.query('UPDATE bid_milestones SET status=$2, due_at=$3, updated_at=now() WHERE id=$1', [current.id, next.status, next.dueAt])
  } else return
  await writeAuditLog(client, { entityType: 'bid', entityId: bidId, field: `timeline:${sync.milestoneKey}`, oldValue: current?.status ?? '', newValue: next.status, reason: `Synced from ${fieldKey}`, action: 'timeline_synced', changedBy: actor ?? null })
}

/** A Timeline milestone linked to a Live Bids field changed: update the field's value on that bid. */
export async function syncMilestoneToField(client: Client, bidId: string, milestoneKey: string, status: string, dueAt: string | null, actor: string | null | undefined) {
  const sync = timelineSyncForMilestone(milestoneKey)
  if (!sync) return
  const field = (await client.query("SELECT id, data_type FROM bid_custom_fields WHERE key=$1 AND status='active'", [sync.field])).rows[0]
  if (!field) return
  const value = fieldValueForMilestone(sync, status, dueAt)
  const old = (await client.query('SELECT value_text, value_date FROM bid_custom_field_values WHERE bid_id=$1 AND field_id=$2', [bidId, field.id])).rows[0]
  const before = old ? String(old.value_text ?? old.value_date ?? '').slice(0, 10) : ''
  if (before === (value ?? '')) return
  if (value === null) await client.query('DELETE FROM bid_custom_field_values WHERE bid_id=$1 AND field_id=$2', [bidId, field.id])
  else {
    const c = customValueColumns(field.data_type as CustomFieldType, value)
    await client.query(`INSERT INTO bid_custom_field_values (bid_id, field_id, value_text, value_number, value_date, value_bool, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (bid_id, field_id) DO UPDATE SET value_text=EXCLUDED.value_text, value_number=EXCLUDED.value_number,
      value_date=EXCLUDED.value_date, value_bool=EXCLUDED.value_bool, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [bidId, field.id, c.text, c.number, c.date, c.bool, actor ?? null])
    await client.query('UPDATE bid_custom_fields SET has_held_value=true WHERE id=$1 AND NOT has_held_value', [field.id])
  }
  await writeAuditLog(client, { entityType: 'bidCustomFieldValue', entityId: bidId, field: sync.field, oldValue: before, newValue: value ?? '', reason: `Synced from Timeline: ${sync.label}`, action: 'custom_value_synced', changedBy: actor ?? null })
}

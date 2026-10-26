import { fieldsUsingMaster } from '@goms/domain'

type Client = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }
const keysOf = (masterKey: string) => fieldsUsingMaster(masterKey).map(f => f.key)

/** Number of bids holding this Live Bids master value (select value, or an item of a multi-select). */
export async function bidMasterUsage(client: Client, masterKey: string, name: string): Promise<number> {
  const keys = keysOf(masterKey)
  if (!keys.length) return 0
  const result = await client.query(
    `SELECT count(DISTINCT v.bid_id)::int AS n FROM bid_custom_field_values v JOIN bid_custom_fields f ON f.id = v.field_id
     WHERE f.key = ANY($1) AND CASE WHEN f.data_type = 'multiselect' THEN v.value_text::jsonb ? $2 ELSE v.value_text = $2 END`, [keys, name])
  return result.rows[0]?.n ?? 0
}

/** A renamed master value follows onto every bid that holds it, so no record is orphaned. */
export async function cascadeBidMasterRename(client: Client, masterKey: string, from: string, to: string): Promise<void> {
  const keys = keysOf(masterKey)
  if (!keys.length || from === to) return
  await client.query(
    `UPDATE bid_custom_field_values v SET value_text = $3 FROM bid_custom_fields f
     WHERE f.id = v.field_id AND f.key = ANY($1) AND f.data_type = 'select' AND v.value_text = $2`, [keys, from, to])
  await client.query(
    `UPDATE bid_custom_field_values v SET value_text = (
       SELECT jsonb_agg(CASE WHEN e = $2 THEN $3 ELSE e END)::text FROM jsonb_array_elements_text(v.value_text::jsonb) e)
     FROM bid_custom_fields f
     WHERE f.id = v.field_id AND f.key = ANY($1) AND CASE WHEN f.data_type = 'multiselect' THEN v.value_text::jsonb ? $2 ELSE false END`, [keys, from, to])
}

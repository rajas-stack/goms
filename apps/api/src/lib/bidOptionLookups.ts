import { BID_TRACKER_MASTER_KEYS, bidSystemField, resolveSystemOptions, withSystemOptions, type BidOptionLookups } from '@goms/domain'

type Client = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }

/** Live option sources for the built-in Live Bids fields (packages/domain/src/bidTrackerFields.ts):
 *  active Live Bids masters, the Competitors list and the active Presales team. */
export async function loadBidOptionLookups(client: Client): Promise<BidOptionLookups> {
  const [masters, competitors, preSales] = await Promise.all([
    client.query('SELECT master_key, name, description FROM commercial_masters WHERE master_key = ANY($1) AND active ORDER BY display_order, name', [BID_TRACKER_MASTER_KEYS]),
    client.query('SELECT name FROM competitors ORDER BY lower(name)'),
    client.query("SELECT name FROM delivery_team_members WHERE team='preSales' AND status='active' ORDER BY lower(name)"),
  ])
  const byKey: BidOptionLookups['masters'] = {}
  for (const r of masters.rows) (byKey[r.master_key as keyof typeof byKey] ??= []).push({ name: r.name, description: r.description })
  return { masters: byKey, competitors: competitors.rows.map(r => r.name), preSales: preSales.rows.map(r => r.name) }
}

/** Field rows with their live options applied (ordinary custom fields unchanged). */
export async function withLiveOptions<T extends { key: string; options?: string[] | null }>(client: Client, fields: T[]) {
  return fields.some(f => bidSystemField(f.key)?.source) ? withSystemOptions(fields, await loadBidOptionLookups(client)) : fields
}

/** Live options of one field, or its stored options for an ordinary custom field. */
export async function liveOptionsFor(client: Client, key: string, stored: string[] | null): Promise<string[] | null> {
  if (!bidSystemField(key)?.source) return stored
  return resolveSystemOptions(key, await loadBidOptionLookups(client))?.options ?? stored
}

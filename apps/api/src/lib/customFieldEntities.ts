// Entity-backed custom column types (person / department / state) store a
// reference, not a name. These helpers check the reference exists and resolve
// its current display name — for validating a write and for readable audit text.
import { TRPCError } from '@trpc/server'
import type { CustomFieldType, CustomValue } from '@goms/domain'

type Client = { query: (sql: string, params?: unknown[]) => Promise<any> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The entity's current name, or null when it does not exist (or is not an entity type). */
export async function entityLabel(client: Client, type: CustomFieldType, value: CustomValue): Promise<string | null> {
  if (value === null || value === undefined) return null
  if (type === 'state') {
    const r = await client.query(`SELECT name FROM hierarchy_nodes WHERE type_key='state' AND state_code=$1 LIMIT 1`, [Number(value)])
    return r.rows[0]?.name ?? null
  }
  if (type !== 'person' && type !== 'department') return null
  const id = String(value)
  if (!UUID.test(id)) return null
  const r = type === 'person'
    ? await client.query(`SELECT name FROM sales_persons WHERE id=$1`, [id])
    : await client.query(`SELECT name FROM hierarchy_nodes WHERE domain='org' AND type_key='department' AND id=$1`, [id])
  return r.rows[0]?.name ?? null
}

/** Rejects a value that points at nothing. */
export async function assertEntityExists(client: Client, type: CustomFieldType, value: CustomValue) {
  if (type !== 'person' && type !== 'department' && type !== 'state') return
  if (value === null) return
  if ((await entityLabel(client, type, value)) === null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `That ${type} does not exist.` })
  }
}

/** Audit text for a value: the entity's name for entity types, else the value itself. */
export async function auditDisplay(client: Client, type: CustomFieldType, value: CustomValue): Promise<string> {
  if (value === null) return ''
  return (await entityLabel(client, type, value)) ?? String(value)
}

// --- bulk import: human cells -> stored references ---------------------------

/** Lower-cased name (people: also official email) -> id/code, built once per
 *  import. A name shared by several records is kept as `null` = ambiguous. */
export interface EntityIndex {
  person: Map<string, string | null>
  department: Map<string, string | null>
  state: Map<string, number>
  personIds: Map<string, string>
  departmentIds: Map<string, string>
  stateNames: Map<number, string>
}

function put<V>(map: Map<string, V | null>, key: string, value: V) {
  const k = key.trim().toLowerCase()
  if (!k) return
  map.set(k, map.has(k) && map.get(k) !== value ? null : value)
}

export async function loadEntityIndex(client: Client): Promise<EntityIndex> {
  const idx: EntityIndex = {
    person: new Map(), department: new Map(), state: new Map(), personIds: new Map(), departmentIds: new Map(), stateNames: new Map(),
  }
  for (const r of (await client.query(`SELECT id, name, official_email FROM sales_persons`)).rows) {
    put(idx.person, r.name, r.id); put(idx.person, r.official_email, r.id); idx.personIds.set(r.id, r.name)
  }
  for (const r of (await client.query(`SELECT id, name FROM hierarchy_nodes WHERE domain='org' AND type_key='department' AND status='active'`)).rows) {
    put(idx.department, r.name, r.id); idx.departmentIds.set(r.id, r.name)
  }
  for (const r of (await client.query(`SELECT name, state_code FROM hierarchy_nodes WHERE type_key='state'`)).rows) {
    idx.state.set(String(r.name).trim().toLowerCase(), r.state_code); idx.stateNames.set(r.state_code, r.name)
  }
  return idx
}

/** Turns what a person typed in a sheet cell into the value `coerceCustomValue`
 *  expects: a name/email becomes the entity's id/code, a multi-select list a JSON
 *  array. Throws a readable message for an unknown or ambiguous name. */
export function resolveImportCell(type: CustomFieldType, raw: unknown, index: EntityIndex): unknown {
  if (typeof raw !== 'string') return raw
  const text = raw.trim()
  if (!text) return raw
  switch (type) {
    case 'person':
    case 'department': {
      if (index[`${type}Ids`].has(text)) return text
      const hit = index[type].get(text.toLowerCase())
      if (hit === undefined) throw new Error(`No ${type} named "${text}".`)
      if (hit === null) throw new Error(`"${text}" matches more than one ${type} — use the exact name.`)
      return hit
    }
    case 'state': {
      if (/^\d+$/.test(text) && index.stateNames.has(Number(text))) return Number(text)
      const hit = index.state.get(text.toLowerCase())
      if (hit === undefined) throw new Error(`No state named "${text}".`)
      return hit
    }
    case 'multiselect': {
      if (text.startsWith('[')) return text
      return JSON.stringify(text.split(text.includes(';') ? ';' : ',').map((s) => s.trim()).filter(Boolean))
    }
    default:
      return raw
  }
}

/** Readable form of a stored value for import previews. */
export function displayStored(type: CustomFieldType, value: CustomValue, index: EntityIndex): string {
  if (value === null) return ''
  if (type === 'person') return index.personIds.get(String(value)) ?? String(value)
  if (type === 'department') return index.departmentIds.get(String(value)) ?? String(value)
  if (type === 'state') return index.stateNames.get(Number(value)) ?? String(value)
  return String(value)
}

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { classifyRows, computeCommitToken, summarize } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult, ImportSummary } from '../types.js'

const DATA_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/../data'

interface RawAdminState {
  st_code: string
  st_nm: string
  districts: { dt_code: string | null; district: string }[]
}
interface RawSubdistrict {
  code: string
  name: string
  dtCode: string
  stCode: number
  villageCount: number
}

type GeoLevel = 'country' | 'state' | 'district' | 'taluka'

interface GeoRow {
  level: GeoLevel
  name: string
  lgdCode: string
  /** null for country; a state's LGD code (as a string) for district and
   *  taluka rows. */
  parentLgdCode: string | null
  /** null for country; the ancestor state's LGD code, numeric, for every
   *  other level. */
  stateCode: number | null
}

/** Disambiguates a district/taluka's LGD code with its state, since raw LGD
 *  codes aren't unique nationwide on their own — same composite-key scheme
 *  `src/data/seed.ts`'s `dtKey()` already uses (11 pairs of unrelated
 *  districts across different states collide on the same `dt_code`, e.g.
 *  Gujarat's Gir Somnath and Tamil Nadu's Kallakurichi both use 729). */
function dtKey(stCode: number | string, dtCode: number | string): string {
  return `${stCode}_${dtCode}`
}

/** Includes `stateCode` explicitly, not just `parentLgdCode` — a taluka's
 *  `parentLgdCode` is its district's raw dt_code, which (unlike the state
 *  code) is *not* guaranteed unique nationwide on its own (the same collision
 *  `dtKey()` above exists to solve for districts). Without `stateCode` in the
 *  key, two different states' same-numbered districts could make two
 *  genuinely different talukas collide onto one business key. */
function businessKey(row: GeoRow): string {
  return `${row.level}|${row.stateCode ?? ''}|${row.parentLgdCode ?? ''}|${row.lgdCode}`
}

// Reserved stateCode for the virtual "Central Ministries (Govt. of India)"
// state — must stay in sync with the frontend's own `CENTRAL_STATE_CODE`
// (src/data/gov-hierarchy.ts): real LGD state codes start at 1.
const CENTRAL_MINISTRIES_STATE_CODE = 0

/** Builds the exact row set the bundled LGD reference data (the same files
 *  `src/data/seed.ts` reads to seed a fresh in-memory install) produces —
 *  country -> states -> districts -> talukas -- plus one synthetic "state"
 *  row for the virtual "Central Ministries (Govt. of India)" node
 *  `src/data/seed.ts` also adds directly (stateCode 0, no real LGD code).
 *
 *  This domain -- not organizationHierarchy -- is the one that can actually
 *  carry it: organizationHierarchy's own `NODE_TYPES` enum (department/
 *  branch/division/office/unit) has no `'state'` value, so a row here isn't
 *  optional routing, it's the only import path this node's `typeKey`
 *  ('state') can validate against. Previously excluded from here on the
 *  (incorrect) assumption organizationHierarchy would cover it instead --
 *  it can't -- which meant this node was never created by any import path,
 *  breaking `hierarchy.getState(0)` and the entire Central Ministries page
 *  in production even though its child org nodes existed and were reachable
 *  by id all along (see the 2026-08-31 production frontend investigation). */
export function buildGeographyRows(): GeoRow[] {
  const admin = JSON.parse(readFileSync(path.join(DATA_DIR, 'india-admin.json'), 'utf-8')) as RawAdminState[]
  const subdistricts = JSON.parse(readFileSync(path.join(DATA_DIR, 'subdistricts.json'), 'utf-8')) as RawSubdistrict[]

  const subdistrictsByDtKey = new Map<string, RawSubdistrict[]>()
  for (const sd of subdistricts) {
    const key = dtKey(sd.stCode, sd.dtCode)
    const list = subdistrictsByDtKey.get(key)
    if (list) list.push(sd)
    else subdistrictsByDtKey.set(key, [sd])
  }

  const rows: GeoRow[] = [
    { level: 'country', name: 'India', lgdCode: 'IN', parentLgdCode: null, stateCode: null },
    {
      level: 'state', name: 'Central Ministries (Govt. of India)', lgdCode: String(CENTRAL_MINISTRIES_STATE_CODE),
      parentLgdCode: null, stateCode: CENTRAL_MINISTRIES_STATE_CODE,
    },
  ]

  for (const st of admin) {
    // Number-normalized, matching seed.ts's own `AdminState.st_code: Number(s.st_code)`
    // — some source rows carry a zero-padded st_code ('06'); the stored LGD
    // code (and every dtKey() built from it) must use the normalized form
    // ('6') to match subdistricts.json's own zero-less dtCode/stCode fields.
    const stCode = Number(st.st_code)
    const stCodeNormalized = String(stCode)
    rows.push({ level: 'state', name: st.st_nm, lgdCode: stCodeNormalized, parentLgdCode: null, stateCode: stCode })

    st.districts.forEach((d, di) => {
      // Same normalization as seed.ts's `dt_code: d.dt_code ? Number(d.dt_code) : ...`
      // (a truthy check, not nullish — an empty-string dt_code also falls
      // through to the synthetic fallback). Without stripping a leading
      // zero here (e.g. '069' -> 69), districts like Haryana's Panchkula
      // never matched their talukas in subdistricts.json, which has no
      // leading zeros ('69') — confirmed empirically: 110 districts and 781
      // talukas silently dropped before this fix.
      const dtCode = d.dt_code ? String(Number(d.dt_code)) : String(stCode * 1000 + di)
      rows.push({ level: 'district', name: d.district, lgdCode: dtCode, parentLgdCode: stCodeNormalized, stateCode: stCode })

      const talukas = subdistrictsByDtKey.get(dtKey(stCode, dtCode)) ?? []
      for (const sd of talukas) {
        rows.push({ level: 'taluka', name: sd.name, lgdCode: sd.code, parentLgdCode: dtCode, stateCode: stCode })
      }
    })
  }

  return rows
}

interface ExistingGeoNode {
  id: string
  name: string
  status: string
}

async function fetchExisting(client: { query: Function }): Promise<Map<string, ExistingGeoNode>> {
  const result = await client.query(`SELECT id, domain, type_key, code, name, status, parent_id, state_code FROM hierarchy_nodes WHERE domain='geo'`)
  const byId = new Map<string, { typeKey: string; code: string; parentId: string | null }>()
  for (const row of result.rows) byId.set(row.id, { typeKey: row.type_key, code: row.code, parentId: row.parent_id })

  const map = new Map<string, ExistingGeoNode>()
  for (const row of result.rows) {
    // A state row's real DB parent is the country row, but
    // buildGeographyRows()'s own business-key convention treats a state's
    // parentLgdCode as null (a state's own code is already globally unique,
    // so it needs no parent for disambiguation) — reconstructing it from
    // the actual DB parent here instead ('IN') would desync every state's
    // key from the freshly-built one and make it look "new" forever.
    const parent = row.type_key !== 'state' && row.parent_id ? byId.get(row.parent_id) : null
    const geoRow: GeoRow = {
      level: row.type_key,
      name: row.name,
      lgdCode: row.code,
      parentLgdCode: parent ? parent.code : null,
      stateCode: row.state_code,
    }
    map.set(businessKey(geoRow), { id: row.id, name: row.name, status: row.status })
  }
  return map
}

function classify(rows: GeoRow[], existingByKey: Map<string, ExistingGeoNode>): ImportRowResult[] {
  return classifyRows<GeoRow, ExistingGeoNode>({
    rows,
    getBusinessKey: (row) => businessKey(row),
    existingByKey,
    diffFields: (row, existing) => {
      const diffs: ImportFieldDiff[] = []
      if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
      return diffs
    },
    validateRow: () => ({ errors: [] }), // every bundled row is trusted, well-formed reference data
  })
}

export interface GeographyPreview {
  rows: ImportRowResult[]
  summary: ImportSummary
  reconciliation: { sourceRowCount: number; classifiedRowCount: number; matches: boolean }
  commitToken: string
}

export async function previewGeographyLoad(client: { query: Function }): Promise<GeographyPreview> {
  const sourceRows = buildGeographyRows()
  const existingByKey = await fetchExisting(client)
  const preview = classify(sourceRows, existingByKey)
  const summaryResult = summarize(preview)

  const reconciliation = {
    sourceRowCount: sourceRows.length,
    classifiedRowCount: summaryResult.toCreate + summaryResult.toUpdate + summaryResult.unchanged,
    matches: sourceRows.length === summaryResult.toCreate + summaryResult.toUpdate + summaryResult.unchanged,
  }

  // The commit token is derived from this preview's own classification
  // result, not the (always-identical, bundled-file-derived) source rows —
  // the source never changes within a deployment, so what must be detected
  // as "stale" is the database having changed since this preview was taken
  // (e.g. a concurrent load, or a manual edit), which shows up as a
  // different classification on re-preview.
  const commitToken = computeCommitToken('geography', { summary: summaryResult, reconciliation })

  return { rows: preview, summary: summaryResult, reconciliation, commitToken }
}

/** The business key of `row`'s parent — reuses `businessKey()` itself via a
 *  synthetic minimal `GeoRow` for the parent, rather than a second parallel
 *  formula, so the two can never drift apart. */
function parentBusinessKeyOf(row: GeoRow): string | null {
  if (row.level === 'country') return null
  if (row.level === 'state') {
    return businessKey({ level: 'country', name: '', lgdCode: 'IN', parentLgdCode: null, stateCode: null })
  }
  if (row.level === 'district') {
    return businessKey({ level: 'state', name: '', lgdCode: row.parentLgdCode!, parentLgdCode: null, stateCode: row.stateCode })
  }
  // taluka: parent is the district row, whose own parentLgdCode is the state's lgdCode.
  return businessKey({ level: 'district', name: '', lgdCode: row.parentLgdCode!, parentLgdCode: String(row.stateCode), stateCode: row.stateCode })
}

const LEVEL_ORDER: GeoLevel[] = ['country', 'state', 'district', 'taluka']

/** Postgres caps bound parameters per statement at 65535; 5 params/row keeps
 *  even a generous chunk size far under that with headroom to spare. */
const INSERT_CHUNK_SIZE = 1000

export async function commitGeographyLoad(
  client: { query: Function },
  commitToken: string,
): Promise<{ summary: ImportSummary }> {
  const fresh = await previewGeographyLoad(client)
  if (fresh.commitToken !== commitToken) {
    throw new Error('This data has changed since it was previewed. Please re-validate before committing.')
  }
  if (!fresh.reconciliation.matches) {
    throw new Error(
      `Reconciliation mismatch: ${fresh.reconciliation.sourceRowCount} source rows but only ` +
      `${fresh.reconciliation.classifiedRowCount} were classified. Refusing to commit.`,
    )
  }

  const sourceRows = buildGeographyRows()
  const existingByKey = await fetchExisting(client) // reused for free ids on 'unchanged' rows — no per-row SELECT needed
  const idByBusinessKey = new Map<string, string>()
  for (const [key, existing] of existingByKey) idByBusinessKey.set(key, existing.id)

  // Processed strictly level-by-level (country, then every state, then
  // every district, then every taluka) rather than in the source files'
  // natural interleaved order — every row at one level only ever needs a
  // parent from the level above, which is therefore already fully resolved
  // (created or already existing) by the time this level's batch runs.
  for (const level of LEVEL_ORDER) {
    const creates: { row: GeoRow; ownKey: string; parentId: string | null }[] = []
    const updates: { row: GeoRow; ownKey: string }[] = []

    for (let i = 0; i < sourceRows.length; i++) {
      const row = sourceRows[i]
      if (row.level !== level) continue
      const result = fresh.rows[i]
      const ownKey = businessKey(row)

      if (result.action === 'create') {
        const parentKey = parentBusinessKeyOf(row)
        const parentId = parentKey === null ? null : idByBusinessKey.get(parentKey) ?? null
        creates.push({ row, ownKey, parentId })
      } else if (result.action === 'update') {
        updates.push({ row, ownKey })
      }
      // 'unchanged' rows need no write — their id is already in
      // idByBusinessKey via existingByKey, seeded above.
    }

    for (let start = 0; start < creates.length; start += INSERT_CHUNK_SIZE) {
      const chunk = creates.slice(start, start + INSERT_CHUNK_SIZE)
      const values: string[] = []
      const params: unknown[] = []
      chunk.forEach((item, idx) => {
        const base = idx * 5
        values.push(`('geo',$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},0,'{}','active')`)
        params.push(item.row.level, item.parentId, item.row.stateCode, item.row.name, item.row.lgdCode)
      })
      const insertResult = await client.query(
        `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
         VALUES ${values.join(',')} RETURNING id`,
        params,
      )
      // Postgres preserves VALUES-list order in a single INSERT...RETURNING,
      // so positional matching against `chunk` is safe.
      insertResult.rows.forEach((r: { id: string }, idx: number) => idByBusinessKey.set(chunk[idx].ownKey, r.id))
    }

    // Updates (a name change on an already-existing row) are expected to be
    // rare — the bulk of a real load is create-only — so these stay
    // per-row rather than batched; disambiguated by state_code (not just
    // type_key+code) since raw LGD codes collide across states.
    for (const { row } of updates) {
      await client.query(
        `UPDATE hierarchy_nodes SET name=$4, updated_at=now()
         WHERE domain='geo' AND type_key=$1 AND code=$2 AND state_code IS NOT DISTINCT FROM $3`,
        [row.level, row.lgdCode, row.stateCode, row.name],
      )
    }
  }

  return { summary: fresh.summary }
}

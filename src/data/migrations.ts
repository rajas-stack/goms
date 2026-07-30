import { uid } from '@/lib/utils'
import type { GormsData } from './seed'

/** Bump when `GormsData`'s shape changes, and add a matching entry to
 *  `MIGRATIONS` keyed by the new number. Unlike the previous
 *  discard-on-mismatch behavior, a stored snapshot is now upgraded in
 *  place — hand-entered data survives a schema change.
 *
 *  v1  the original shape (nodes, employees, externalIds, timeline, transfers)
 *  v2  opportunities + opportunityStageChanges; works leave node metadata
 *  v3  followUps
 */
export const SCHEMA_VERSION = 3

/** Migrations run over loosely-typed data: an old snapshot by definition
 *  does not match today's `GormsData`, so typing the input as `GormsData`
 *  would be a lie that hides real shape differences. */
export type SnapshotShape = Record<string, unknown>

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

/** Reads a department's legacy `metadata.works` JSON. Mirrors the old
 *  `parseWorks`, including its migration of a single-string `component`
 *  to a one-item array. Malformed JSON yields an empty list rather than
 *  throwing — a corrupt blob must not block the whole migration. */
function parseLegacyWorks(raw: unknown): Record<string, unknown>[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as Record<string, unknown>[]).map((w) => ({
      ...w,
      component: Array.isArray(w.component) ? w.component : w.component ? [w.component] : [],
    }))
  } catch {
    return []
  }
}

/** v1 → v2. Lifts every department's `metadata.works` blob into a real
 *  `opportunities` collection and removes the metadata key.
 *
 *  Deliberately writes NO `opportunityStageChange` rows: a migrated
 *  opportunity's real stage history is unknown, and inventing one would
 *  put fabricated data into the substrate the analytics layer reads.
 *  Stage history begins at the first stage change made in the app. */
function toV2(data: SnapshotShape): SnapshotShape {
  if (!Array.isArray(data.nodes)) {
    throw new Error('Invalid snapshot: nodes must be an array')
  }
  const nodes = asArray(data.nodes)
  const opportunities: Record<string, unknown>[] = []

  for (const node of nodes) {
    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    if (!('works' in metadata)) continue

    for (const w of parseLegacyWorks(metadata.works)) {
      opportunities.push({
        ...w,
        id: typeof w.id === 'string' && w.id ? w.id : uid('opp'),
        departmentId: node.id,
        stateCode: node.stateCode ?? null,
        stageKey: 'pipeline',
        closedOn: null,
        createdAt: '',
        createdBy: null,
      })
    }

    const { works: _dropped, ...rest } = metadata
    node.metadata = rest
  }

  return { ...data, nodes, opportunities, opportunityStageChanges: [] }
}

/** v2 → v3. Turns each employee's single `followUpDate` field into a real
 *  `FollowUp` record.
 *
 *  `employee.followUpDate` is intentionally left in place: it is still read
 *  by the search intent filters and the employee form, and Phase 3 removes
 *  it once `FollowUp` fully replaces it. Removing it here would break those
 *  call sites mid-phase. */
function toV3(data: SnapshotShape): SnapshotShape {
  const employees = asArray(data.employees)
  const followUps: Record<string, unknown>[] = []

  for (const e of employees) {
    if (typeof e.followUpDate !== 'string' || !e.followUpDate) continue
    followUps.push({
      id: uid('fup'),
      entityType: 'contact',
      entityId: e.id,
      assigneeId: null,
      dueDate: e.followUpDate,
      status: 'open',
      note: '',
      createdAt: '',
      createdBy: null,
    })
  }

  return { ...data, followUps }
}

/** Keyed by the version each step PRODUCES, so applying every key from
 *  `fromVersion + 1` up to `SCHEMA_VERSION` walks the chain in order. */
export const MIGRATIONS: Record<number, (data: SnapshotShape) => SnapshotShape> = {
  2: toV2,
  3: toV3,
}

/** Upgrades a stored snapshot to `SCHEMA_VERSION`.
 *
 *  Returns `null` when the snapshot cannot be migrated — a version from a
 *  newer build (we cannot downgrade), a nonsensical version, a non-object
 *  payload, or a step that throws. The caller falls back to seed data,
 *  which is the same outcome as the old discard behavior but now reserved
 *  for genuinely unrecoverable input rather than every schema bump. */
export function migrateSnapshot(raw: unknown, fromVersion: number): GormsData | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!Number.isInteger(fromVersion) || fromVersion < 1) return null
  if (fromVersion > SCHEMA_VERSION) return null

  let data = raw as SnapshotShape
  try {
    for (let v = fromVersion + 1; v <= SCHEMA_VERSION; v++) {
      const step = MIGRATIONS[v]
      if (!step) return null
      data = step(data)
    }
  } catch {
    return null
  }
  return data as unknown as GormsData
}

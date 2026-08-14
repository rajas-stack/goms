import { SCHEMA_VERSION, migrateSnapshot } from './migrations'
import { downloadFile } from '@/lib/file-export'
import type { GormsData } from './seed'

/** Whole-app JSON backup — everything in `GormsData`, as one file. Distinct
 *  from `ExportDialog`'s CSV export, which is Account Mapping's own
 *  per-dataset download and covers neither Sales nor Commercial Calculator
 *  data. Reuses the same schema-version machinery `persist.ts` already
 *  applies to the IndexedDB snapshot, so a backup restores exactly like a
 *  browser reload would: an old backup is migrated forward, not rejected. */
export const BACKUP_KIND = 'gorms-full-backup'

export interface BackupEnvelope {
  kind: typeof BACKUP_KIND
  schemaVersion: number
  exportedAt: string
  data: GormsData
}

export function buildBackupEnvelope(data: GormsData): BackupEnvelope {
  return { kind: BACKUP_KIND, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data }
}

export type ParseBackupResult =
  | { ok: true; data: GormsData; exportedAt: string }
  | { ok: false; error: string }

/** Validates and migrates a backup file's raw text. Never throws — every
 *  failure mode (bad JSON, wrong file, corrupt/unmigratable data) comes back
 *  as `{ ok: false, error }` so the caller can show it inline rather than
 *  crash the dialog. */
export function parseBackupFile(raw: string): ParseBackupResult {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: 'This file is not a GOMS backup.' }
  }
  const envelope = json as Record<string, unknown>
  if (envelope.kind !== BACKUP_KIND) {
    return { ok: false, error: 'This file is not a GOMS backup.' }
  }
  if (typeof envelope.schemaVersion !== 'number') {
    return { ok: false, error: 'This backup is missing its schema version.' }
  }
  const migrated = migrateSnapshot(envelope.data, envelope.schemaVersion)
  if (!migrated) {
    return { ok: false, error: 'This backup could not be read — it may be corrupt or from a newer version of GOMS.' }
  }
  return { ok: true, data: migrated, exportedAt: typeof envelope.exportedAt === 'string' ? envelope.exportedAt : '' }
}

/** Downloads `data` as a dated JSON backup file, via the same
 *  platform-specific save mechanism CSV export uses. */
export async function downloadBackup(data: GormsData): Promise<void> {
  const envelope = buildBackupEnvelope(data)
  const fileName = `gorms-backup-${envelope.exportedAt.slice(0, 10)}.json`
  await downloadFile(fileName, JSON.stringify(envelope, null, 2), 'application/json')
}

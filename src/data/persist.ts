import { SCHEMA_VERSION, migrateSnapshot } from './migrations'
import type { GormsData } from './seed'

/** Local persistence for the in-memory store, so a reload — or the Android
 *  shell being swiped away and reopened — doesn't throw away everything the
 *  user has entered.
 *
 *  IndexedDB rather than localStorage: a full snapshot of `GormsData` is ~2MB
 *  (7k+ seeded hierarchy nodes and their external ids dominate it), which is
 *  at or past what localStorage safely holds on Safari and the Android
 *  WebView — and localStorage writes are synchronous, so a 2MB write would
 *  block the main thread on every edit. IDB is async and effectively unbounded
 *  here.
 *
 *  A whole-snapshot write (rather than a diff against the seed) is the
 *  deliberate trade: this store exists until the Supabase-backed `Repository`
 *  lands (see repository.ts), so the simplest correct thing wins over the
 *  cheapest payload. Writes are debounced and coalesced, so a burst of edits
 *  costs one write.
 *
 *  Schema versioning lives in `migrations.ts`: a snapshot written by an
 *  older build is upgraded in place rather than discarded, so hand-entered
 *  data survives a schema change. Only genuinely unmigratable input (a
 *  newer build's snapshot, a corrupt payload) falls back to the seed. */

const DB_NAME = 'gorms'
const STORE = 'snapshot'
const BLOB_STORE = 'blobs'
const KEY = 'data'
/** IndexedDB database version — distinct from the DATA schema version in
 *  migrations.ts. Bump only when adding or removing an object store. */
const DB_VERSION = 2

interface Envelope {
  version: number
  savedAt: string
  data: GormsData
}

/** Resolves to `null` — never rejects — whenever IDB is unavailable: private
 *  browsing, a blocked upgrade, or a WebView with storage disabled. Persistence
 *  is an enhancement; the app has to keep working on the seed without it. */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

async function readEnvelope(): Promise<Envelope | null> {
  const db = await openDb()
  if (!db) return null
  try {
    return await new Promise<Envelope | null>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve((req.result as Envelope | undefined) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  } finally {
    db.close()
  }
}

export async function loadSnapshot(): Promise<GormsData | null> {
  const envelope = await readEnvelope()
  if (!envelope) return null
  // A version mismatch is now an upgrade, not a discard — see migrations.ts.
  // `null` here means genuinely unmigratable, and the caller falls back to
  // seed data exactly as before.
  const migrated = migrateSnapshot(envelope.data, envelope.version)

  // Persist the upgrade immediately rather than waiting for the user's next
  // edit. Writes are otherwise mutation-triggered, so a session that only
  // *reads* would leave the old version on disk indefinitely: it would be
  // re-migrated on every load, ids minted during the migration would differ
  // each time, and — the real hazard — a later build that retired this
  // version's migration step would find no path forward, return null, and
  // fall back to the seed. That would lose exactly the hand-entered data the
  // migration chain exists to protect.
  if (migrated && envelope.version !== SCHEMA_VERSION) await writeSnapshot(migrated)

  return migrated
}

async function writeSnapshot(data: GormsData): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    const envelope: Envelope = { version: SCHEMA_VERSION, savedAt: new Date().toISOString(), data }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(envelope, KEY)
      tx.oncomplete = () => resolve()
      // A failed save is not worth surfacing to the user mid-edit — the edit
      // itself succeeded in memory either way, and the next one retries.
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // Quota exceeded or the store vanished — same reasoning as above.
  } finally {
    db.close()
  }
}

const SAVE_DELAY_MS = 400
let timer: ReturnType<typeof setTimeout> | undefined
let pending: (() => GormsData) | undefined
let flushHooked = false

function flush() {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  const getData = pending
  pending = undefined
  if (getData) void writeSnapshot(getData())
}

/** Queues a debounced save. `getData` is called at write time (not now), so a
 *  burst of edits coalesces into one write of the final state. */
export function scheduleSave(getData: () => GormsData): void {
  pending = getData
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(flush, SAVE_DELAY_MS)

  if (flushHooked) return
  flushHooked = true
  // Android can freeze or kill the WebView as soon as the app is backgrounded,
  // and a browser tab can close, either of which would drop a debounced write
  // still sitting in its timeout. `visibilitychange` (not `beforeunload`, which
  // mobile WebViews often skip) is the reliable last chance to get it out.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
}

/** Drops the stored snapshot — the escape hatch for a corrupt or unwanted
 *  local copy. The in-memory store is untouched; the seed returns on reload. */
export async function clearSnapshot(): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } finally {
    db.close()
  }
}

export { BLOB_STORE, DB_NAME, DB_VERSION }
export { openDb as openGormsDb }

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
 *  costs one write. */

const DB_NAME = 'gorms'
const STORE = 'snapshot'
const KEY = 'data'

/** Bump this whenever `GormsData`'s shape changes, or whenever a seed change
 *  needs to reach users who already have a snapshot — a stored snapshot always
 *  wins over the seed, so without a bump a stale copy would shadow the new
 *  seed data forever. A mismatched snapshot is discarded, not migrated. */
const SCHEMA_VERSION = 1

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
      req = indexedDB.open(DB_NAME, 1)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

export async function loadSnapshot(): Promise<GormsData | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const envelope = await new Promise<Envelope | undefined>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result as Envelope | undefined)
      req.onerror = () => resolve(undefined)
    })
    if (!envelope || envelope.version !== SCHEMA_VERSION) return null
    return envelope.data
  } catch {
    return null
  } finally {
    db.close()
  }
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

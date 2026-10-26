import { SCHEMA_VERSION, migrateSnapshot } from './migrations'
import { notifyOtherTabs, onOtherTabChange } from './crossTabSync'
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
  /** Unique per write; absent on snapshots saved before cross-tab sync. */
  rev?: string
}

/** `rev` of the stored snapshot this tab's in-memory store was loaded from or last
 *  wrote. A write only lands while the stored `rev` still equals it — otherwise
 *  another tab saved in between and this tab's copy is stale (see writeSnapshot). */
let baseRev: string | undefined

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
  baseRev = envelope.rev
  // A version mismatch is now an upgrade, not a discard — see migrations.ts.
  // `null` here means genuinely unmigratable, and the caller falls back to
  // seed data exactly as before.
  const migrated = migrateSnapshot(envelope.data, envelope.version)

  // Persist the upgrade immediately rather than waiting for the user's next
  // edit. Writes are otherwise mutation-triggered, so a session that only
  // *reads* would leave the old version on disk indefinitely.
  if (migrated && envelope.version !== SCHEMA_VERSION) await writeSnapshot(migrated)

  return migrated
}

/** Fired on every failed write attempt — e.g. the browser is blocking
 *  storage for this origin. The edit stays safe in memory for the current
 *  tab, but nothing is on disk, so a reload would lose it silently unless
 *  something surfaces this. `ToastProvider` listens for it (one warning per
 *  page load); this module stays decoupled from React. */
export const PERSIST_FAILED_EVENT = 'gorms:persist-failed'

/** Fired once the bounded automatic retries below give up. `detail.retry`
 *  re-runs the same save immediately, wired up by `ToastProvider` as a
 *  manual "Retry" action. */
export const PERSIST_RETRY_EXHAUSTED_EVENT = 'gorms:persist-retry-exhausted'

/** Fired when a save succeeds after a previous failure — lets the UI
 *  confirm recovery instead of leaving the last warning as a dangling,
 *  unresolved message. */
export const PERSIST_RECOVERED_EVENT = 'gorms:persist-recovered'

/** Fired when this tab's unsaved edit was dropped because another tab saved
 *  first (see writeSnapshot) — the user has to redo it, so it can't be silent. */
export const PERSIST_CONFLICT_EVENT = 'gorms:persist-conflict'

/** No-ops outside a browser (Node test environments) rather than crashing on
 *  a missing global. Real browsers always have `window`, so production
 *  behavior is unchanged. */
function dispatchWindowEvent(event: Event): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(event)
}

function reportPersistFailure(reason: string): void {
  console.error(`[gorms] local save failed: ${reason}`)
  dispatchWindowEvent(new CustomEvent(PERSIST_FAILED_EVENT, { detail: { reason } }))
}

type WriteResult = 'saved' | 'conflict' | 'failed'

/** Never rejects, matching every other function in this module. 'conflict'
 *  means another tab saved since this tab last loaded or saved: nothing is
 *  written, because this tab's copy lacks that tab's change and would erase it.
 *  The check and the write share one readwrite transaction, which IndexedDB
 *  runs exclusively per store, so no other tab can slip a write in between. */
async function writeSnapshot(data: GormsData): Promise<WriteResult> {
  const db = await openDb()
  if (!db) {
    reportPersistFailure('IndexedDB unavailable')
    return 'failed'
  }
  try {
    const rev = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    return await new Promise<WriteResult>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      let result: WriteResult = 'saved'
      const current = store.get(KEY)
      current.onsuccess = () => {
        const stored = current.result as Envelope | undefined
        if (stored && stored.rev !== baseRev) { result = 'conflict'; return }
        const envelope: Envelope = { version: SCHEMA_VERSION, savedAt: new Date().toISOString(), data, rev }
        store.put(envelope, KEY)
      }
      tx.oncomplete = () => {
        if (result === 'saved') {
          baseRev = rev
          notifyOtherTabs()
        }
        resolve(result)
      }
      // The edit itself already succeeded in memory either way — this only
      // means it isn't on disk yet — but that has to be visible somewhere,
      // or it silently keeps not-saving until data is lost on reload.
      tx.onerror = () => { reportPersistFailure(tx.error?.message ?? 'transaction error'); resolve('failed') }
      tx.onabort = () => { reportPersistFailure(tx.error?.message ?? 'transaction aborted'); resolve('failed') }
    })
  } catch (e) {
    reportPersistFailure(e instanceof Error ? e.message : String(e))
    return 'failed'
  } finally {
    db.close()
  }
}

const SAVE_DELAY_MS = 400
let timer: ReturnType<typeof setTimeout> | undefined
let pending: (() => GormsData) | undefined
let flushHooked = false

/** Backoff schedule for automatic retries after a failed save, in
 *  milliseconds. `nextRetryDelay` is the only thing that reads this. */
const RETRY_DELAYS_MS = [1000, 3000, 8000]
const MAX_AUTO_RETRIES = RETRY_DELAYS_MS.length

/** Pure lookup, no IndexedDB/DOM involved — the one part of the retry
 *  machinery that's actually unit-testable in this project's vitest setup
 *  (node environment, no IDB/DOM). Returns the delay before the next
 *  automatic attempt, or `null` once `attempt` has reached the bound and
 *  automatic retries must stop. */
export function nextRetryDelay(attempt: number): number | null {
  if (attempt >= MAX_AUTO_RETRIES) return null
  return RETRY_DELAYS_MS[attempt]
}

let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryAttempt = 0
let hasEverFailed = false
let inFlightWrite: Promise<WriteResult> | null = null

function clearRetryTimer() {
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
}

/** Runs at most one IndexedDB write transaction at a time — a manual
 *  "Retry" click landing while an automatic retry is already in flight
 *  reuses that same attempt instead of racing a second transaction against
 *  it (the "no duplicate writes" requirement). */
function writeOnce(data: GormsData): Promise<WriteResult> {
  if (inFlightWrite) return inFlightWrite
  inFlightWrite = writeSnapshot(data).finally(() => { inFlightWrite = null })
  return inFlightWrite
}

/** One save attempt for `getData`, with bounded backoff retry on failure.
 *  `getData` is re-invoked on every retry (not just once up front), so a
 *  retry after the user kept editing saves their latest state rather than
 *  replaying the stale payload that first failed. Stops automatically after
 *  `MAX_AUTO_RETRIES` attempts and fires `PERSIST_RETRY_EXHAUSTED_EVENT`
 *  with a `retry` callback instead of retrying forever. */
async function attempt(getData: () => GormsData): Promise<void> {
  const result = await writeOnce(getData())
  if (result === 'conflict') return discardForNewerSnapshot()
  if (result === 'saved') {
    clearRetryTimer()
    if (hasEverFailed) dispatchWindowEvent(new CustomEvent(PERSIST_RECOVERED_EVENT))
    hasEverFailed = false
    retryAttempt = 0
    return
  }
  hasEverFailed = true
  const delay = nextRetryDelay(retryAttempt)
  if (delay === null) {
    dispatchWindowEvent(new CustomEvent(PERSIST_RETRY_EXHAUSTED_EVENT, {
      detail: { retry: () => { retryAttempt = 0; void attempt(getData) } },
    }))
    return
  }
  retryAttempt += 1
  clearRetryTimer()
  retryTimer = setTimeout(() => void attempt(getData), delay)
}

function flush() {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  const getData = pending
  pending = undefined
  // A fresh debounced save supersedes any pending backoff retry of a
  // previous failure — there's new data to save, and it deserves its own
  // full retry budget rather than inheriting an unrelated failure streak's
  // exhausted count.
  clearRetryTimer()
  retryAttempt = 0
  if (getData) void attempt(getData)
}

/** Queues a debounced save. `getData` is called at write time (not now), so a
 *  burst of edits coalesces into one write of the final state. */
export function scheduleSave(getData: () => GormsData): void {
  pending = getData
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(flush, SAVE_DELAY_MS)

  if (flushHooked) return
  flushHooked = true
  // Guards a non-browser caller (Node test environments calling a
  // not-yet-migrated in-memory mutator through this same persistence-wrapping
  // proxy) rather than crashing on a missing global. Real browsers always
  // have `document`/`window`, so production behavior is unchanged.
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  // Android can freeze or kill the WebView as soon as the app is backgrounded,
  // and a browser tab can close, either of which would drop a debounced write
  // still sitting in its timeout. `visibilitychange` (not `beforeunload`, which
  // mobile WebViews often skip) is the reliable last chance to get it out.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
}

let applySnapshot: ((data: GormsData) => void) | undefined

/** Edits this tab hasn't got onto disk yet: queued, mid-write, or failed. */
function hasUnsavedEdits(): boolean {
  return pending !== undefined || inFlightWrite !== null || hasEverFailed
}

/** Adopts the stored snapshot when another tab has saved a newer one. Skipped
 *  while this tab has unsaved edits — replacing the store would silently drop
 *  them; their own write then hits the rev check and lands in
 *  `discardForNewerSnapshot`, which comes back here. */
async function adoptNewerSnapshot(): Promise<void> {
  if (!applySnapshot || hasUnsavedEdits()) return
  const envelope = await readEnvelope()
  // Re-checked after the await: an edit made during the read is unsaved too.
  if (!envelope || envelope.rev === baseRev || hasUnsavedEdits()) return
  const data = migrateSnapshot(envelope.data, envelope.version)
  if (!data) return
  baseRev = envelope.rev
  applySnapshot(data)
}

/** First save wins: this tab's edit was made on a stale copy, so it is dropped
 *  (and the user told) and the newer snapshot adopted, rather than letting it
 *  overwrite the other tab's change. */
async function discardForNewerSnapshot(): Promise<void> {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  pending = undefined
  clearRetryTimer()
  retryAttempt = 0
  hasEverFailed = false
  dispatchWindowEvent(new CustomEvent(PERSIST_CONFLICT_EVENT))
  await adoptNewerSnapshot()
}

/** Keeps this tab's store in step with snapshots other tabs save. `apply` gets
 *  the newer data and must swap it in WITHOUT scheduling a save — a save would
 *  re-broadcast it to every tab, forever. */
export function syncWithOtherTabs(apply: (data: GormsData) => void): void {
  applySnapshot = apply
  onOtherTabChange(() => void adoptNewerSnapshot())
  // A frozen or back/forward-cached tab can miss a message; catch up when it's shown again.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void adoptNewerSnapshot()
    })
  }
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

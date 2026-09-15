export const CHUNK_RELOAD_STORAGE_KEY = 'gorms:chunk-reload-attempted'

// Marks the TARGET object itself, not module-scoped state (e.g. a WeakSet) —
// main.test.tsx re-imports main.tsx via vi.resetModules() across multiple
// test cases against the same persistent jsdom `window`, and each re-import
// evaluates a fresh copy of this module. Only a marker written onto the
// target survives that; a fresh module-scoped WeakSet would not.
const INSTALLED_MARKER = '__gormsStaleChunkRecoveryInstalled'

interface RecoveryTarget {
  addEventListener(type: string, listener: (event: Event) => void): void
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  location: Pick<Location, 'reload'>
}

/** A fresh deploy replaces every content-hashed JS chunk filename. A tab
 *  that was already open before that happens still holds the OLD filenames
 *  baked into its already-loaded bundle; navigating to a route whose chunk
 *  changed then fails to dynamically import it — Firebase Hosting's SPA
 *  rewrite (`"source": "**"`) serves index.html (200, text/html) for the
 *  now-missing asset path instead of a 404, which the browser rejects as an
 *  invalid module MIME type. That TypeError otherwise reaches React
 *  Router's root errorElement (GlobalErrorScreen) as an uncaught crash (see
 *  the 2026-09-15 goms-prod incident: a click-through right after a
 *  frontend deploy hit exactly this).
 *
 *  Vite dispatches a cancelable `vite:preloadError` event for exactly this
 *  failure before it re-throws — calling `preventDefault()` suppresses the
 *  re-throw, so reloading here recovers silently instead of ever showing
 *  the crash screen. Guarded by sessionStorage to one attempt: a GENUINE,
 *  repeating failure (not just stale-deploy timing) must still fall through
 *  to GlobalErrorScreen rather than reload-looping forever. */
export function installStaleChunkRecovery(target?: RecoveryTarget): void {
  // A default parameter of `= window` would throw a bare ReferenceError in
  // any context with no global `window` (SSR, a Node-based build step) the
  // instant this is called with no arguments — before the function body
  // even runs. `typeof` is the one reference form that never throws on an
  // undeclared identifier, so it's the only safe way to fall back here.
  const resolved = target ?? (typeof window === 'undefined' ? undefined : window)
  if (!resolved) return

  const marked = resolved as RecoveryTarget & Record<string, boolean>
  if (marked[INSTALLED_MARKER]) return
  marked[INSTALLED_MARKER] = true

  resolved.addEventListener('vite:preloadError', (event) => {
    if (resolved.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)) return
    resolved.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, '1')
    event.preventDefault()
    resolved.location.reload()
  })
}

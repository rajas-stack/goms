import { authApi } from '@/lib/auth'

/** Live updates from other users (server mode only): the API's `GET /api/events` stream says "something changed"
 *  after anyone's save, and this tab refetches through its normal, permission-checked queries. Browser-only mode has
 *  no shared server, so there is nothing to listen to there.
 *
 *  fetch, not EventSource: EventSource can't send the `Authorization` header this API authenticates with, and a
 *  credential in the URL would end up in proxy logs. The server ends each stream after one change (or 50 s), so a
 *  proxy that buffers until the response ends still delivers promptly; this reconnects at once after a normal end,
 *  and with backoff after a failure. */

export const DEBOUNCE_MS = 300
export const RETRY_MIN_MS = 1000
export const RETRY_MAX_MS = 30_000

export interface LiveUpdateOptions {
  url: string
  fetch: typeof fetch
  getHeaders: () => Promise<Record<string, string>>
  /** Called once per burst of changes (debounced). */
  onChange: () => void
}

/** Returns stop. */
export function startLiveUpdates({ url, fetch, getHeaders, onChange }: LiveUpdateOptions): () => void {
  const abort = new AbortController()
  let debounce: ReturnType<typeof setTimeout> | undefined
  const changed = () => {
    clearTimeout(debounce)
    debounce = setTimeout(onChange, DEBOUNCE_MS)
  }

  void (async () => {
    let retryMs = RETRY_MIN_MS
    let missedSome = false
    while (!abort.signal.aborted) {
      try {
        const res = await fetch(url, { headers: await getHeaders(), signal: abort.signal, cache: 'no-store' })
        // A non-stream answer (e.g. an HTML fallback page) must back off, not reconnect in a tight loop.
        if (!res.ok || !res.body || !res.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error(`HTTP ${res.status}`)
        retryMs = RETRY_MIN_MS
        // Changes made while disconnected were never heard: refetch once now.
        if (missedSome) changed()
        missedSome = false
        if (await readUntilChange(res.body)) changed()
      } catch {
        if (abort.signal.aborted) return
        missedSome = true
        await new Promise((resolve) => setTimeout(resolve, retryMs))
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
      }
    }
  })()

  return () => {
    abort.abort()
    clearTimeout(debounce)
  }
}

/** True once the server sent a change; false if the stream just ended (its lifetime cap). */
async function readUntilChange(body: ReadableStream<Uint8Array>): Promise<boolean> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let received = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return false
    received += decoder.decode(value, { stream: true })
    if (/^data:/m.test(received)) {
      void reader.cancel().catch(() => {})
      return true
    }
  }
}

/** Runs the stream while someone is signed in (or always, in a build that can't sign anyone in, where the API
 *  doesn't authenticate either). A hidden tab defers its refetch until it is shown again. */
export function watchServerChanges(onChange: () => void): void {
  const base = import.meta.env.VITE_API_BASE_URL ?? ''
  let stop: (() => void) | undefined
  let missedWhileHidden = false
  const refresh = () => {
    if (document.hidden) missedWhileHidden = true
    else onChange()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !missedWhileHidden) return
    missedWhileHidden = false
    onChange()
  })
  authApi.subscribe((user, loading) => {
    if (loading) return
    const shouldRun = Boolean(user) || !authApi.configured
    if (shouldRun && !stop) {
      stop = startLiveUpdates({ url: `${base}/api/events`, fetch: authApi.fetch, getHeaders: () => authApi.getAuthorizationHeaders(), onChange: refresh })
    } else if (!shouldRun && stop) {
      stop()
      stop = undefined
    }
  })
}

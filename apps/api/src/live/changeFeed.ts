import { Client } from 'pg'

/** Live updates across users: after every successful mutation this process NOTIFYs `goms_changes`; every API process
 *  (each Cloud Run instance) LISTENs on one dedicated connection and wakes its open `/api/events` streams, whose
 *  browsers then refetch through their own permission-checked queries. Nothing about the changed records travels
 *  here — only the procedure path and a time, for diagnostics. */
export const CHANGE_CHANNEL = 'goms_changes'
/** Per process. Beyond it a new stream is refused (503) and the browser retries with backoff. */
export const MAX_STREAMS = 500
/** A burst of NOTIFYs (an import, a multi-row save) wakes each stream once. */
export const FAN_OUT_DELAY_MS = 250
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30_000

type Stream = () => void
const streams = new Set<Stream>()
let fanOutTimer: ReturnType<typeof setTimeout> | undefined
/** The LISTENing connection, once LISTEN succeeded; NOTIFYs go out on it too. */
let listening: Client | undefined

/** `onChange` runs (once) on the next change. Returns the unsubscribe, or null when this process is at MAX_STREAMS. */
export function subscribe(onChange: Stream): (() => void) | null {
  if (streams.size >= MAX_STREAMS) return null
  streams.add(onChange)
  return () => { streams.delete(onChange) }
}

/** Wakes every open stream on this process (coalesced). Exported for the route test. */
export function wakeStreams(): void {
  fanOutTimer ??= setTimeout(() => {
    fanOutTimer = undefined
    for (const stream of [...streams]) stream()
  }, FAN_OUT_DELAY_MS)
}

/** Fire-and-forget, after a mutation succeeded. A no-op until the listener is connected — in tests, and briefly
 *  while it reconnects (whose catch-up wake covers this process; other processes miss that one change). */
export function announceChange(path: string): void {
  listening?.query('SELECT pg_notify($1, $2)', [CHANGE_CHANNEL, JSON.stringify({ path, at: Date.now() })])
    .catch(() => console.warn(JSON.stringify({ event: 'live.notify_failed', path })))
}

/** Holds one LISTEN connection outside the pool for the life of the process, reconnecting with backoff. Returns stop. */
export function startChangeListener(
  createClient: () => Client = () => new Client({ connectionString: process.env.DATABASE_URL, keepAlive: true }),
): () => void {
  let stopped = false
  let client: Client | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryMs = RECONNECT_MIN_MS
  let heardBefore = false

  const drop = (c: Client | undefined) => {
    if (!c) return
    if (listening === c) listening = undefined
    c.removeAllListeners()
    c.on('error', () => {}) // a late error on a dropped client must not crash the process
    c.end().catch(() => {})
  }
  const reconnect = () => {
    drop(client)
    client = undefined
    if (stopped || retryTimer) return
    console.warn(JSON.stringify({ event: 'live.listener_down', retryMs }))
    retryTimer = setTimeout(() => { retryTimer = undefined; void connect() }, retryMs)
    retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS)
  }
  const connect = async () => {
    const c = createClient()
    client = c
    c.on('notification', (msg) => { if (msg.channel === CHANGE_CHANNEL) wakeStreams() })
    c.on('error', reconnect)
    c.on('end', reconnect)
    try {
      await c.connect()
      await c.query(`LISTEN ${CHANGE_CHANNEL}`)
      if (stopped || client !== c) return drop(c)
      listening = c
      retryMs = RECONNECT_MIN_MS
      // Changes made while the listener was down were never heard: every open stream refetches once.
      if (heardBefore) wakeStreams()
      heardBefore = true
    } catch {
      if (client === c) reconnect()
    }
  }

  void connect()
  return () => {
    stopped = true
    clearTimeout(retryTimer)
    drop(client)
  }
}

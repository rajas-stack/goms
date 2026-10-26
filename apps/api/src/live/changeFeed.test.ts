import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from 'pg'

/** Stands in for the dedicated LISTEN connection. */
class FakeClient extends EventEmitter {
  connect = vi.fn(async () => {})
  query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }))
  end = vi.fn(async () => {})
}

async function freshFeed() {
  vi.resetModules()
  return import('./changeFeed.js')
}

function clientFactory() {
  const clients: FakeClient[] = []
  const create = () => { const c = new FakeClient(); clients.push(c); return c as unknown as Client }
  return { clients, create }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('change feed', () => {
  it('LISTENs on one dedicated connection and NOTIFYs only the procedure path and a time', async () => {
    const feed = await freshFeed()
    const { clients, create } = clientFactory()
    feed.announceChange('bids.update') // not connected yet: a no-op, never a pool query
    const stop = feed.startChangeListener(create)
    await vi.advanceTimersByTimeAsync(0)
    expect(clients).toHaveLength(1)
    expect(clients[0].query).toHaveBeenCalledWith('LISTEN goms_changes')

    feed.announceChange('bids.update')
    const [sql, params] = clients[0].query.mock.calls[1]
    expect(sql).toBe('SELECT pg_notify($1, $2)')
    expect(params?.[0]).toBe('goms_changes')
    expect(Object.keys(JSON.parse(String(params?.[1]))).sort()).toEqual(['at', 'path'])
    expect(JSON.parse(String(params?.[1])).path).toBe('bids.update')
    stop()
  })

  it('wakes each open stream once per burst of notifications', async () => {
    const feed = await freshFeed()
    const { clients, create } = clientFactory()
    const stop = feed.startChangeListener(create)
    await vi.advanceTimersByTimeAsync(0)
    const a = vi.fn(), b = vi.fn()
    feed.subscribe(a)
    feed.subscribe(b)

    for (let i = 0; i < 3; i++) clients[0].emit('notification', { channel: 'goms_changes', payload: '{}' })
    clients[0].emit('notification', { channel: 'something_else', payload: '{}' })
    await vi.advanceTimersByTimeAsync(feed.FAN_OUT_DELAY_MS)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    stop()
  })

  it('reconnects with backoff after the connection drops, then wakes streams to catch up', async () => {
    const feed = await freshFeed()
    const { clients, create } = clientFactory()
    const stop = feed.startChangeListener(create)
    await vi.advanceTimersByTimeAsync(0)
    const stream = vi.fn()
    feed.subscribe(stream)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    clients[0].emit('error', new Error('connection terminated'))
    expect(clients[0].end).toHaveBeenCalled()
    feed.announceChange('bids.update') // dropped while down
    expect(clients[0].query).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(clients).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(clients).toHaveLength(2)
    expect(clients[1].query).toHaveBeenCalledWith('LISTEN goms_changes')
    await vi.advanceTimersByTimeAsync(feed.FAN_OUT_DELAY_MS)
    expect(stream).toHaveBeenCalledTimes(1)
    // A late error on the dropped connection is harmless.
    expect(() => clients[0].emit('error', new Error('late'))).not.toThrow()
    stop()
  })

  it('refuses streams beyond the per-process cap, and frees a slot on unsubscribe', async () => {
    const feed = await freshFeed()
    const unsubscribes = Array.from({ length: feed.MAX_STREAMS }, () => feed.subscribe(() => {}))
    expect(unsubscribes.every(Boolean)).toBe(true)
    expect(feed.subscribe(() => {})).toBeNull()
    unsubscribes[0]!()
    expect(feed.subscribe(() => {})).not.toBeNull()
  })
})

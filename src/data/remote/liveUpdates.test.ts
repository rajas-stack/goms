import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ authApi: {} }))

import { DEBOUNCE_MS, RETRY_MIN_MS, startLiveUpdates } from './liveUpdates'

type Answer = (signal: AbortSignal) => Response | Promise<Response>

const encoder = new TextEncoder()
function eventStream(chunks: string[], signal: AbortSignal, { end = true } = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      if (end) controller.close()
      else signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}
const change: Answer = (signal) => eventStream([': connected\n\n', 'data: change\n\n'], signal)
const failure: Answer = () => Promise.reject(new TypeError('network down'))
/** Once the scripted answers run out, the stream stays open (until stopped). */
const openForever: Answer = (signal) => eventStream([': connected\n\n'], signal, { end: false })

function run(...answers: Answer[]) {
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => (answers.shift() ?? openForever)(init!.signal!))
  const onChange = vi.fn()
  const stop = startLiveUpdates({ url: '/api/events', fetch: fetch as unknown as typeof globalThis.fetch, getHeaders: async () => ({ Authorization: 'Bearer t' }), onChange })
  return { fetch, onChange, stop }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('live updates client', () => {
  it('turns a burst of changes into one refresh, reconnecting after each', async () => {
    const { fetch, onChange, stop } = run(change, change, change)
    await vi.advanceTimersByTimeAsync(10)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer t' })
    expect(onChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
  })

  it('reconnects at once, without a refresh, when a stream simply reaches its lifetime', async () => {
    const { fetch, onChange, stop } = run((signal) => eventStream([': connected\n\n', ': ping\n\n'], signal))
    await vi.advanceTimersByTimeAsync(10)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onChange).not.toHaveBeenCalled()
    stop()
  })

  it('backs off after failures and refreshes once on recovery (changes may have been missed)', async () => {
    const { fetch, onChange, stop } = run(failure, failure)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RETRY_MIN_MS - 1)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2 * RETRY_MIN_MS)
    expect(fetch).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
  })

  it('backs off instead of looping on a response that is not an event stream', async () => {
    const html: Answer = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
    const { fetch, stop } = run(html, html, html)
    await vi.advanceTimersByTimeAsync(RETRY_MIN_MS - 1)
    expect(fetch).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops: aborts the open stream, drops a pending refresh, and never reconnects', async () => {
    const { fetch, onChange, stop } = run(change)
    await vi.advanceTimersByTimeAsync(10)
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onChange).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

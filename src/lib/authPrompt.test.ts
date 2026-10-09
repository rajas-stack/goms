import { beforeEach, describe, expect, it, vi } from 'vitest'

// authPrompt keeps module-level state (the listener set and the pending reason), so each test gets a fresh copy.
async function load() {
  vi.resetModules()
  return await import('./authPrompt')
}

describe('authPrompt pending reason', () => {
  beforeEach(() => vi.resetModules())

  it('delivers a reason set before anyone subscribed to the first subscriber (asynchronously)', async () => {
    const { setPendingAuthReason, subscribeAuthRequired } = await load()
    setPendingAuthReason('forbidden')
    const listener = vi.fn()
    subscribeAuthRequired(listener)
    expect(listener).not.toHaveBeenCalled() // queueMicrotask delivery, never re-entrant
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('forbidden')
  })
  it('delivers it exactly once: a second subscriber does not get it again', async () => {
    const { setPendingAuthReason, subscribeAuthRequired } = await load()
    setPendingAuthReason('unauthorized')
    const first = vi.fn()
    const second = vi.fn()
    subscribeAuthRequired(first)
    await Promise.resolve()
    subscribeAuthRequired(second)
    await Promise.resolve()
    expect(first).toHaveBeenCalledWith('unauthorized')
    expect(second).not.toHaveBeenCalled()
  })
  it('without a pending reason, subscribing delivers nothing', async () => {
    const { subscribeAuthRequired } = await load()
    const listener = vi.fn()
    subscribeAuthRequired(listener)
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
  })
  it('notifyAuthRequired still reaches live subscribers, and unsubscribing stops it', async () => {
    const { notifyAuthRequired, subscribeAuthRequired } = await load()
    const listener = vi.fn()
    const off = subscribeAuthRequired(listener)
    notifyAuthRequired('forbidden')
    expect(listener).toHaveBeenCalledWith('forbidden')
    off()
    notifyAuthRequired('unauthorized')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('raiseAuthReason (R19): a reason raised from outside React reaches the user whether or not the dialog is mounted yet', () => {
  it('with a live subscriber it is delivered immediately and nothing is left pending', async () => {
    const { raiseAuthReason, subscribeAuthRequired } = await load()
    const first = vi.fn()
    subscribeAuthRequired(first)
    raiseAuthReason('forbidden')
    expect(first).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith('forbidden')
    const later = vi.fn()
    subscribeAuthRequired(later)
    await Promise.resolve()
    expect(later).not.toHaveBeenCalled() // no stale pending reason leaks into a later mount
  })
  it('with no subscriber it is stored pending and delivered once to the next subscriber', async () => {
    const { raiseAuthReason, subscribeAuthRequired } = await load()
    raiseAuthReason('unauthorized')
    const first = vi.fn()
    subscribeAuthRequired(first)
    await Promise.resolve()
    expect(first).toHaveBeenCalledWith('unauthorized')
    const second = vi.fn()
    subscribeAuthRequired(second)
    await Promise.resolve()
    expect(second).not.toHaveBeenCalled()
  })
  it('after the only subscriber unsubscribes it falls back to pending again', async () => {
    const { raiseAuthReason, subscribeAuthRequired } = await load()
    const off = subscribeAuthRequired(vi.fn())
    off()
    raiseAuthReason('forbidden')
    const next = vi.fn()
    subscribeAuthRequired(next)
    await Promise.resolve()
    expect(next).toHaveBeenCalledWith('forbidden')
  })
})

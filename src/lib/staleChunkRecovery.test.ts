import { describe, it, expect, vi } from 'vitest'
import { installStaleChunkRecovery, CHUNK_RELOAD_STORAGE_KEY } from './staleChunkRecovery'

function fakeTarget(initialFlag?: string) {
  // A real EventTarget accumulates one listener per addEventListener call —
  // an array, not a Map keyed by type, so a test calling install() twice
  // against the same target can actually observe accumulation instead of
  // one call silently overwriting the other.
  const listeners = new Map<string, ((event: Event) => void)[]>()
  const store = new Map<string, string>()
  if (initialFlag) store.set(CHUNK_RELOAD_STORAGE_KEY, initialFlag)
  const reload = vi.fn()
  return {
    target: {
      addEventListener: (type: string, cb: (event: Event) => void) => {
        const existing = listeners.get(type) ?? []
        listeners.set(type, [...existing, cb])
      },
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v) },
      },
      location: { reload },
    },
    emit(type: string, event: Event) { listeners.get(type)?.forEach((cb) => cb(event)) },
    listenerCount: (type: string) => (listeners.get(type) ?? []).length,
    reload,
  }
}

function fakePreloadErrorEvent() {
  return { preventDefault: vi.fn() } as unknown as Event
}

describe('installStaleChunkRecovery', () => {
  it('reloads once and prevents the default rethrow on the first stale-chunk error', () => {
    const { target, emit, reload } = fakeTarget()
    installStaleChunkRecovery(target)

    const event = fakePreloadErrorEvent()
    emit('vite:preloadError', event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(target.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBe('1')
  })

  it('does not reload again, and lets the error through, if a reload was already attempted this session', () => {
    const { target, emit, reload } = fakeTarget('1')
    installStaleChunkRecovery(target)

    const event = fakePreloadErrorEvent()
    emit('vite:preloadError', event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not touch any other event type', () => {
    const { target, emit, reload } = fakeTarget()
    installStaleChunkRecovery(target)

    emit('error', fakePreloadErrorEvent())

    expect(reload).not.toHaveBeenCalled()
  })

  // main.test.tsx re-imports main.tsx via vi.resetModules() across multiple
  // test cases against the SAME persistent jsdom `window` — each re-import
  // calls installStaleChunkRecovery() again with a freshly-evaluated copy of
  // this module, so a module-scoped guard (e.g. a WeakSet) wouldn't help;
  // only marking the target object itself survives that.
  it('registers only one listener no matter how many times it is called against the same target', () => {
    const { target, emit, reload, listenerCount } = fakeTarget()

    installStaleChunkRecovery(target)
    installStaleChunkRecovery(target)
    installStaleChunkRecovery(target)

    expect(listenerCount('vite:preloadError')).toBe(1)

    emit('vite:preloadError', fakePreloadErrorEvent())
    expect(reload).toHaveBeenCalledTimes(1)
  })

  // This file runs under Vitest's plain `node` environment (vite.config.ts),
  // which has no global `window` at all — a real stand-in for an SSR/build
  // context, not a simulation. Calling with no arguments must not crash the
  // caller (main.tsx calls it exactly this way).
  it('does not throw when called with no arguments in an environment with no global window', () => {
    expect(typeof window).toBe('undefined')
    expect(() => installStaleChunkRecovery()).not.toThrow()
  })
})

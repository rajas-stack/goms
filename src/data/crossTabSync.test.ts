import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GormsData } from './seed'

// Each "tab" is a fresh module instance (vi.resetModules) with its own in-memory
// state and channel, while all tabs share one fake IndexedDB, as real tabs do.

type Handler = (() => void) | null

function installFakeIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>()
  let puts = 0
  const later = (fn: () => void) => setTimeout(fn, 0)
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => stores.set(name, new Map()),
    close: () => {},
    transaction: (name: string) => {
      const store = stores.get(name)!
      let open = 0
      const tx = { oncomplete: null as Handler, onerror: null as Handler, onabort: null as Handler, error: null, objectStore: () => objectStore }
      const request = (run: () => unknown) => {
        const req = { result: undefined as unknown, onsuccess: null as Handler, onerror: null as Handler }
        open++
        later(() => {
          req.result = run()
          req.onsuccess?.()
          if (--open === 0) later(() => tx.oncomplete?.())
        })
        return req
      }
      const objectStore = {
        get: (key: string) => request(() => structuredClone(store.get(key))),
        put: (value: unknown, key: string) => request(() => { puts++; store.set(key, structuredClone(value)) }),
        delete: (key: string) => request(() => store.delete(key)),
      }
      return tx
    },
  }
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req = { result: db, onupgradeneeded: null as Handler, onsuccess: null as Handler, onerror: null as Handler, onblocked: null as Handler }
      later(() => { req.onupgradeneeded?.(); req.onsuccess?.() })
      return req
    },
  })
  return {
    storedData: () => (stores.get('snapshot')?.get('data') as { data: unknown } | undefined)?.data,
    puts: () => puts,
  }
}

/** Delivers to every other open channel of the same name, never back to the sender. */
class FakeBroadcastChannel extends EventTarget {
  static open = new Set<FakeBroadcastChannel>()
  constructor(readonly name: string) { super(); FakeBroadcastChannel.open.add(this) }
  postMessage(data: unknown) {
    for (const other of FakeBroadcastChannel.open) {
      if (other !== this && other.name === this.name) setTimeout(() => other.dispatchEvent(new MessageEvent('message', { data })), 0)
    }
  }
  close() { FakeBroadcastChannel.open.delete(this) }
}

const snapshot = (tag: string) => ({ tag }) as unknown as GormsData
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function openPersistTab() {
  vi.resetModules()
  const persist = await import('./persist')
  await persist.loadSnapshot()
  const applied = vi.fn()
  persist.syncWithOtherTabs(applied)
  return { ...persist, applied }
}

let idb: ReturnType<typeof installFakeIndexedDB>

beforeEach(() => {
  FakeBroadcastChannel.open.clear()
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  idb = installFakeIndexedDB()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cross-tab sync (browser-only mode)', () => {
  it("adopts another tab's save without echoing it back, then saves normally on top of it", async () => {
    const a = await openPersistTab()
    const b = await openPersistTab()

    a.scheduleSave(() => snapshot('from A'))
    await vi.waitFor(() => expect(b.applied).toHaveBeenCalledWith(snapshot('from A')), { timeout: 3000 })

    // B swapped A's snapshot in without saving it, so nothing is re-written or re-broadcast.
    await sleep(50)
    expect(a.applied).not.toHaveBeenCalled()
    expect(idb.puts()).toBe(1)

    // B's copy is current now: its own next save is accepted and reaches A.
    b.scheduleSave(() => snapshot('from B'))
    await vi.waitFor(() => expect(a.applied).toHaveBeenCalledWith(snapshot('from B')), { timeout: 3000 })
    expect(idb.storedData()).toEqual(snapshot('from B'))
  })

  it('refuses a stale write: the first save wins, and the stale tab adopts it and is told', async () => {
    const win = new EventTarget()
    const conflicts = vi.fn()
    vi.stubGlobal('window', win)
    const a = await openPersistTab()
    const b = await openPersistTab()
    win.addEventListener(b.PERSIST_CONFLICT_EVENT, conflicts)

    a.scheduleSave(() => snapshot('from A'))
    await sleep(100)
    // B edits its (soon stale) copy before A's save lands; its unsaved edit
    // must not be swapped out under it when A's message arrives…
    b.scheduleSave(() => snapshot('stale B'))

    // …but B's own write then finds A's newer snapshot and is refused.
    await vi.waitFor(() => expect(b.applied).toHaveBeenCalledWith(snapshot('from A')), { timeout: 3000 })
    expect(b.applied).toHaveBeenCalledTimes(1)
    expect(conflicts).toHaveBeenCalledTimes(1)
    expect(idb.storedData()).toEqual(snapshot('from A'))
    expect(idb.puts()).toBe(1)
  })

  it('shows a Vertical created in one tab in the other tab, and refreshes its screens', async () => {
    vi.resetModules()
    const tab1 = await import('./repository')
    const refreshTab1 = vi.fn()
    await tab1.bootstrapRepository(refreshTab1)
    vi.resetModules()
    const tab2 = await import('./repository')
    const refreshTab2 = vi.fn()
    await tab2.bootstrapRepository(refreshTab2)

    await tab2.repository.createMaster('verticals', { code: 'XTAB', name: 'Cross-tab Vertical', description: '' })

    await vi.waitFor(() => expect(refreshTab1).toHaveBeenCalledTimes(1), { timeout: 5000 })
    const names = (await tab1.repository.listMaster('verticals')).map((v) => v.name)
    expect(names).toContain('Cross-tab Vertical')
    expect(refreshTab2).not.toHaveBeenCalled()
  }, 60_000)
})

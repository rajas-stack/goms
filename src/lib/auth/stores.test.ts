import { afterEach, describe, expect, it, vi } from 'vitest'

const { native } = vi.hoisted(() => ({ native: { value: null as string | null } }))
vi.mock('./native', () => ({
  createSecureTokenStore: () => ({ get: async () => native.value, set: async (t: string) => { native.value = t }, clear: async () => { native.value = null } }),
}))
import { ShellUpdateRequiredError } from './errors'
import { createLocalStorageStore, selectTokenStore } from './stores'

afterEach(() => { native.value = null; vi.unstubAllGlobals() })
const stubLocalStorage = () => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) })
  return data
}

describe('createLocalStorageStore (T10a)', () => {
  it('when setItem throws it removes the stale token instead of leaving a replay-able (already rotated) one behind', async () => {
    const data = new Map<string, string>([['k', 'OLD']])
    const removeItem = vi.fn((k: string) => void data.delete(k))
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError') }, removeItem })
    const store = createLocalStorageStore('k')
    await expect(store.set('NEW')).resolves.toBeUndefined()
    expect(removeItem).toHaveBeenCalledWith('k')
    expect(await store.get()).toBeNull()                         // signed out on the next load rather than presenting the rotated token (a reuse trap)
  })
  it('a blocked storage whose removeItem also throws still never throws', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    await expect(createLocalStorageStore('k').set('NEW')).resolves.toBeUndefined()
  })
})

describe('selectTokenStore', () => {
  it('a plain browser keeps the refresh token in localStorage', async () => {
    const data = stubLocalStorage()
    const store = selectTokenStore({ inShell: false, secureStorage: false })
    await store.set('R'); expect([...data.values()]).toEqual(['R'])
  })
  it('inside the shell with secure storage, tokens go to the secure store and NEVER to localStorage', async () => {
    const data = stubLocalStorage()
    const store = selectTokenStore({ inShell: true, secureStorage: true })
    await store.set('R'); expect(native.value).toBe('R'); expect(await store.get()).toBe('R'); expect(data.size).toBe(0)
    await store.clear(); expect(native.value).toBeNull()
  })
  it('inside an old shell WITHOUT secure storage there is no fallback: set throws, nothing is written anywhere', async () => {
    const data = stubLocalStorage()
    const store = selectTokenStore({ inShell: true, secureStorage: false })
    await expect(store.set('R')).rejects.toBeInstanceOf(ShellUpdateRequiredError)
    expect(await store.get()).toBeNull(); expect(data.size).toBe(0); expect(native.value).toBeNull()
    await expect(store.clear()).resolves.toBeUndefined()
  })
})

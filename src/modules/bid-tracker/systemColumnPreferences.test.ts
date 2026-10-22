import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
  return { store, uid: null as string | null }
})
vi.mock('@/lib/auth', () => ({ currentAuthUid: () => h.uid }))
import { readSystemColumns, saveSystemColumns } from './systemColumnPreferences'

beforeEach(() => { h.store.clear(); h.uid = null })

describe('system column preferences are per person', () => {
  it('stores and reads under the signed-in uid (a Firebase uid, or g:<sub> under direct Google OAuth)', () => {
    h.uid = 'g:1029384756'
    saveSystemColumns('pipeline', 'default', ['name', 'stage'])
    expect([...h.store.keys()]).toEqual(['gorms:grid-columns:g:1029384756:pipeline:default'])
    expect(readSystemColumns('pipeline', 'default')).toEqual(['name', 'stage'])
  })

  it('never shows one person\'s columns to another on the same browser', () => {
    h.uid = 'g:1'
    saveSystemColumns('pipeline', 'default', ['name'])
    h.uid = 'g:2'
    expect(readSystemColumns('pipeline', 'default')).toBeUndefined()
    saveSystemColumns('pipeline', 'default', ['stage'])
    h.uid = 'g:1'
    expect(readSystemColumns('pipeline', 'default')).toEqual(['name'])
  })

  it('leaves preferences saved under the previous provider\'s uid untouched (nothing is overwritten or adopted; they are simply not visible to the new id)', () => {
    h.uid = 'firebase-uid-old'
    saveSystemColumns('pipeline', 'default', ['name', 'owner'])
    h.uid = 'g:1029384756'
    expect(readSystemColumns('pipeline', 'default')).toBeUndefined()
    saveSystemColumns('pipeline', 'default', ['stage'])
    expect(h.store.get('gorms:grid-columns:firebase-uid-old:pipeline:default')).toBe(JSON.stringify(['name', 'owner']))
  })

  it('uses the shared "local" key only while nobody is signed in (exactly as before)', () => {
    saveSystemColumns('pipeline', 'default', ['name'])
    expect([...h.store.keys()]).toEqual(['gorms:grid-columns:local:pipeline:default'])
  })
})

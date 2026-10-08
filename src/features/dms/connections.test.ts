import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTIONS_KEY, loadConnections, moduleForPath, removeConnection, saveConnection, type DmsConnection } from './connections'
import { DEFAULT_DMS_SETTINGS, saveSettings } from './settings'

const connection = (id: string, name: string, patch: Partial<DmsConnection> = {}): DmsConnection => ({ id, name, modules: [], isMaster: false, settings: { ...DEFAULT_DMS_SETTINGS }, ...patch })
describe('Multiple DMS connections', () => {
  const storage = new Map<string, string>()
  beforeEach(() => { storage.clear(); vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }) })
  afterEach(() => vi.unstubAllGlobals())
  it('keeps multiple named connections and independent OAuth inputs', () => {
    saveConnection(connection('sales', 'Sales Drive', { settings: { ...DEFAULT_DMS_SETTINGS, clientId: '123-sales.apps.googleusercontent.com' } }))
    saveConnection(connection('bids', 'Bid Drive', { settings: { ...DEFAULT_DMS_SETTINGS, clientId: '456-bids.apps.googleusercontent.com' } }))
    expect(loadConnections()).toHaveLength(2)
    expect(loadConnections().find((item) => item.id === 'bids')?.settings.clientId).toBe('456-bids.apps.googleusercontent.com')
  })
  it('atomically reassigns places while preserving other assignments', () => {
    saveConnection(connection('first', 'First', { modules: ['sales', 'teams'] }))
    saveConnection(connection('second', 'Second', { modules: ['sales', 'meetings'] }))
    expect(loadConnections().find((item) => item.id === 'first')?.modules).toEqual(['teams'])
    expect(loadConnections().find((item) => item.id === 'second')?.modules).toEqual(['sales', 'meetings'])
  })
  it('allows one master and keeps it separate from module assignments', () => {
    saveConnection(connection('master', 'All documents', { isMaster: true, modules: ['sales'] }))
    expect(loadConnections()[0].modules).toEqual([])
    expect(() => saveConnection(connection('second', 'Second master', { isMaster: true }))).toThrow('already exists')
  })
  it('prevents duplicate names used for master subfolders', () => {
    saveConnection(connection('one', 'Sales'))
    expect(() => saveConnection(connection('two', ' sales '))).toThrow('already uses')
  })
  it('preserves the earlier single-DMS configuration', () => {
    saveSettings({ ...DEFAULT_DMS_SETTINGS, rootFolderId: 'old-root', clientId: '123-old.apps.googleusercontent.com' })
    expect(loadConnections()[0].id).toBe('legacy')
    saveConnection(connection('new', 'New'))
    expect(loadConnections().find((item) => item.id === 'legacy')?.settings.rootFolderId).toBe('old-root')
  })
  it('removes configuration without document API calls', () => {
    saveConnection(connection('one', 'One'))
    removeConnection('one')
    expect(loadConnections()).toEqual([])
    expect(storage.get(CONNECTIONS_KEY)).toBe('[]')
  })
  it('resolves the configured places from actual application routes', () => {
    expect(moduleForPath('/sales/opportunities')).toBe('sales')
    expect(moduleForPath('/bid-tracker/bid/123')).toBe('opportunity')
    expect(moduleForPath('/commercial-calculator/boq/123')).toBe('commercial')
    expect(moduleForPath('/settings/dms')).toBeNull()
  })
})

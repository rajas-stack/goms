import { DEFAULT_DMS_SETTINGS, DMS_SETTINGS_KEY, loadSettings, validateSettings, type DmsSettings } from './settings'

export const DMS_MODULES = [
  { id: 'accounts', label: 'Accounts mapping' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'sales', label: 'Sales' },
  { id: 'teams', label: 'Teams' },
  { id: 'commercial', label: 'Commercial calculator' },
  { id: 'opportunity', label: 'Opportunity / Bid tracker' },
] as const
export type DmsModule = typeof DMS_MODULES[number]['id']
export interface DmsConnection {
  id: string
  name: string
  modules: DmsModule[]
  isMaster: boolean
  settings: DmsSettings
  accountEmail?: string
  lastConnectedAt?: string
  lastSyncedAt?: string
}
export const CONNECTIONS_KEY = 'goms.dms.connections.v2'
export const CONNECTIONS_CHANGED = 'goms:dms-connections-changed'

export function loadConnections(): DmsConnection[] {
  try {
    const stored = localStorage.getItem(CONNECTIONS_KEY)
    if (stored) {
      const parsed: unknown = JSON.parse(stored)
      if (!Array.isArray(parsed)) return []
      return parsed.map((item) => ({
        id: String(item.id), name: String(item.name), isMaster: Boolean(item.isMaster),
        modules: Array.isArray(item.modules) ? item.modules.filter((id: unknown) => DMS_MODULES.some((module) => module.id === id)) : [],
        settings: validateSettings({ ...DEFAULT_DMS_SETTINGS, ...item.settings }),
        accountEmail: typeof item.accountEmail === 'string' ? item.accountEmail : undefined,
        lastConnectedAt: typeof item.lastConnectedAt === 'string' ? item.lastConnectedAt : undefined,
        lastSyncedAt: typeof item.lastSyncedAt === 'string' ? item.lastSyncedAt : undefined,
      }))
    }
    // Preserve a setup saved before multiple connections were introduced.
    if (localStorage.getItem(DMS_SETTINGS_KEY)) {
      const settings = loadSettings()
      if (settings.clientId || settings.rootFolderId || settings.externalUrl) {
        return [{ id: 'legacy', name: 'Existing DMS', modules: [], isMaster: false, settings }]
      }
    }
  } catch { /* Storage may be unavailable or contain an invalid old record. */ }
  return []
}

function writeConnections(connections: DmsConnection[]): void {
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONNECTIONS_CHANGED))
}

export function saveConnection(connection: DmsConnection): DmsConnection {
  const all = loadConnections()
  const name = connection.name.trim()
  if (!name || name.length > 120) throw new Error('Enter a DMS name between 1 and 120 characters.')
  if (all.some((item) => item.id !== connection.id && item.name.toLowerCase() === name.toLowerCase())) throw new Error('Another DMS already uses that name.')
  const settings = validateSettings(connection.settings)
  if (connection.isMaster && settings.provider !== 'google-drive') throw new Error('The master DMS must use Google Drive.')
  if (connection.isMaster && all.some((item) => item.id !== connection.id && item.isMaster)) throw new Error('A master DMS already exists. Edit it instead.')
  const modules = connection.isMaster ? [] : [...new Set(connection.modules)].filter((id) => DMS_MODULES.some((module) => module.id === id))
  const valid: DmsConnection = {
    id: connection.id, name, modules, isMaster: connection.isMaster, settings,
    accountEmail: connection.accountEmail, lastConnectedAt: connection.lastConnectedAt, lastSyncedAt: connection.lastSyncedAt,
  }
  // A place has one designated DMS. Reassignment is a single saved update.
  const updated = all.filter((item) => item.id !== valid.id).map((item) => ({ ...item, modules: item.modules.filter((id) => !modules.includes(id)) }))
  writeConnections([...updated, valid])
  return valid
}

export function removeConnection(id: string): void {
  writeConnections(loadConnections().filter((item) => item.id !== id))
}

export function moduleForPath(path: string): DmsModule | null {
  if (/^\/(map|state|directory|analytics)(\/|$)/.test(path)) return 'accounts'
  if (path === '/') return 'accounts'
  if (/^\/meetings(\/|$)/.test(path)) return 'meetings'
  if (/^\/sales(\/|$)/.test(path)) return 'sales'
  if (/^\/teams(\/|$)/.test(path)) return 'teams'
  if (/^\/commercial-calculator(\/|$)/.test(path)) return 'commercial'
  if (/^\/bid-tracker(\/|$)/.test(path)) return 'opportunity'
  return null
}

import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { DEFAULT_GOOGLE_INTEGRATIONS, GOOGLE_SERVICES, type GoogleIntegrationSettings, type GoogleService } from '@goms/domain'
import type { AppRouter } from '../../../apps/api/src/index'
import { getAuthHeaders } from '@/data/remote/authHeaders'
import { loadConnections } from '@/features/dms/connections'
import { assertGoogleAccount, getGoogleAccount, notifyIntegrations, type GoogleAccount } from './session'
const cache = new Map<string, GoogleIntegrationSettings>()
const loading = new Map<string, { state: 'loading' | 'ready' | 'error'; error?: string }>()
export const googleSettingsStatus = (uid: string) => loading.get(uid) ?? { state: 'loading' as const }
const client = import.meta.env.VITE_API_BASE_URL ? createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc`, headers: getAuthHeaders })] }) : null
const key = (uid: string) => `goms.google-integrations.${encodeURIComponent(uid)}`
export function validateGoogleSettings(value: GoogleIntegrationSettings): GoogleIntegrationSettings {
  if (value.clientId && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(value.clientId)) throw new Error('Enter a valid Google OAuth web client ID.')
  if (!/^[\w-]*$/.test(value.docsId) || !/^[\w-]*$/.test(value.sheetsId)) throw new Error('Enter a document or spreadsheet ID, not its full link.')
  if (value.cloudProject && !/^[a-z0-9][a-z0-9-]*$/.test(value.cloudProject)) throw new Error('Enter a valid Google Cloud project ID or number.')
  if (!['global', 'us', 'eu'].includes(value.notebookLocation)) throw new Error('Choose a NotebookLM location.')
  const disabledPages: GoogleIntegrationSettings['disabledPages'] = {}
  for (const service of GOOGLE_SERVICES) {
    const pages = value.disabledPages?.[service]
    if (pages && (!Array.isArray(pages) || pages.some(page => !/^[a-z][a-z0-9-]{0,79}$/.test(page)))) throw new Error('Invalid integration page selection.')
    if (pages) disabledPages[service] = [...new Set(pages)]
  }
  return { clientId: value.clientId.trim(), disabledPages, docsId: value.docsId.trim(), sheetsId: value.sheetsId.trim(), cloudProject: value.cloudProject.trim(), notebookLocation: value.notebookLocation }
}
export function googleSettings(account: GoogleAccount | null): GoogleIntegrationSettings {
  if (!account) return { ...DEFAULT_GOOGLE_INTEGRATIONS, disabledPages: {} }
  if (!cache.has(account.uid)) {
    let saved = DEFAULT_GOOGLE_INTEGRATIONS
    try { saved = validateGoogleSettings({ ...DEFAULT_GOOGLE_INTEGRATIONS, ...JSON.parse(localStorage.getItem(key(account.uid)) ?? '{}') }) } catch { /* Recover invalid local metadata. */ }
    const dms = loadConnections().find(item => item.settings.clientId && (!item.accountEmail || item.accountEmail.toLowerCase() === account.email))
    cache.set(account.uid, { ...saved, clientId: saved.clientId || dms?.settings.clientId || import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '' })
  }
  return cache.get(account.uid)!
}
export async function loadGoogleSettings(account: GoogleAccount) {
  assertGoogleAccount(account)
  loading.set(account.uid, { state: 'loading' }); notifyIntegrations()
  try {
    if (client) {
      const saved = validateGoogleSettings(await client.googleIntegrations.get.query({ accountUid: account.uid }))
      assertGoogleAccount(account)
      cache.set(account.uid, { ...saved, clientId: saved.clientId || googleSettings(account).clientId })
    }
    loading.set(account.uid, { state: 'ready' }); notifyIntegrations()
    return googleSettings(account)
  } catch (cause) {
    loading.set(account.uid, { state: 'error', error: cause instanceof Error ? cause.message : 'Could not load integration settings.' }); notifyIntegrations(); throw cause
  }
}
export async function saveGoogleSettings(account: GoogleAccount, value: GoogleIntegrationSettings) {
  assertGoogleAccount(account)
  const clean = validateGoogleSettings(value)
  if (client && googleSettingsStatus(account.uid).state !== 'ready') throw new Error('Load your integration settings before saving changes.')
  if (client) await client.googleIntegrations.save.mutate({ accountUid: account.uid, settings: clean })
  assertGoogleAccount(account)
  try { localStorage.setItem(key(account.uid), JSON.stringify(clean)) } catch { if (!client) throw new Error('Settings could not be saved on this device.') }
  cache.set(account.uid, clean)
  notifyIntegrations()
  return clean
}
/** Newly declared pages are enabled automatically unless the user explicitly disables them. */
export function googleServiceEnabled(service: GoogleService, pageId: string) {
  return !googleSettings(getGoogleAccount()).disabledPages[service]?.includes(pageId)
}
const writes = new Map<string, Promise<unknown>>()
export function updateGoogleSettings(account: GoogleAccount, update: (current: GoogleIntegrationSettings) => GoogleIntegrationSettings) {
  const task = (writes.get(account.uid) ?? Promise.resolve()).catch(() => undefined).then(() => {
    assertGoogleAccount(account)
    return saveGoogleSettings(account, update(googleSettings(account)))
  })
  writes.set(account.uid, task)
  return task
}

import type { GoogleService, GoogleIntegrationSettings } from '@goms/domain'
import { loadGoogleIdentity } from '@/features/dms/googleDrive'
import { productFor } from './catalog'
import { assertGoogleAccount, getGoogleAccount, getGoogleSession, hasGoogleScope, saveGoogleSession, invalidateGoogleSession, type GoogleAccount } from './session'
import { googleServiceEnabled, googleSettings } from './settings'

const IDENTITY_SCOPES = ['openid', 'email']
export async function googleApiRequest<T>(url: string, token: string, project?: string): Promise<T> {
  const destination = new URL(url)
  if (destination.protocol !== 'https:' || !destination.hostname.endsWith('.googleapis.com') || destination.username || destination.password) throw new Error('Google tokens may only be sent to approved Google API endpoints.')
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...(project ? { 'x-goog-user-project': project } : {}) }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (response.status === 401) { invalidateGoogleSession(token); throw new Error('Google authorization expired. Reconnect and retry.') }
    throw new Error(body?.error?.message ?? `Google connection failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}
/** Call from a user action after preloading GIS. Consent is requested only for the service being used. */
export async function authorizeGoogle(account: GoogleAccount, scopes: readonly string[], clientId: string): Promise<string> {
  assertGoogleAccount(account)
  const existing = getGoogleSession(scopes, clientId)
  if (existing) return Promise.resolve(existing.accessToken)
  if (!clientId) return Promise.reject(new Error('Save your Google OAuth client ID in Connection setup.'))
  const google = (window as typeof window & { google?: Awaited<ReturnType<typeof loadGoogleIdentity>> }).google
  if (!google) return Promise.reject(new Error('Google sign-in is still loading. Retry in a moment.'))
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: [...new Set([...IDENTITY_SCOPES, ...scopes])].join(' '), include_granted_scopes: true,
      login_hint: account.email, hd: 'amnex.com',
      error_callback: error => reject(new Error(error.type === 'popup_closed' ? 'Google authorization was cancelled.' : 'Allow the Google authorization popup and retry.')),
      callback: response => {
        void (async () => {
          assertGoogleAccount(account)
          if (response.error || !response.access_token) throw new Error(response.error_description ?? 'Google permission was not granted.')
          const granted = (response.scope ?? '').split(' ')
          if (!scopes.every(scope => hasGoogleScope(granted, scope))) throw new Error('The required service permission was not granted.')
          const identity = await googleApiRequest<{ sub: string; email: string; email_verified: boolean; hd?: string }>('https://openidconnect.googleapis.com/v1/userinfo', response.access_token)
          assertGoogleAccount(account)
          if (!identity.email_verified || identity.hd !== 'amnex.com' || identity.email.toLowerCase() !== account.email || identity.sub !== account.googleId) throw new Error('Use the same Amnex Google account that is signed in to GOMS.')
          saveGoogleSession({ uid: account.uid, email: account.email, accessToken: response.access_token, scopes: granted,
            expiresAt: Date.now() + Math.max(0, Math.min(response.expires_in ?? 3600, 3600)) * 1000, clientId })
          resolve(response.access_token)
        })().catch(reject)
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}
export function googleFeatureToken(service: GoogleService, pageId: string): Promise<string> {
  if (!googleServiceEnabled(service, pageId)) return Promise.reject(new Error('This service is disabled on this page in Settings > Integrations.'))
  const account = getGoogleAccount()
  if (!account) return Promise.reject(new Error('Sign in with your verified Amnex Google account.'))
  return authorizeGoogle(account, productFor(service).scopes, googleSettings(account).clientId)
}
export interface ConnectionTest { status: 'verified' | 'authorized' | 'account'; message: string }
const NOTEBOOK_LOCATIONS: readonly string[] = ['global', 'us', 'eu']

export async function testGoogleConnection(service: GoogleService, account: GoogleAccount, settings: GoogleIntegrationSettings): Promise<ConnectionTest> {
  assertGoogleAccount(account)
  const product = productFor(service)
  if (product.mode === 'web') return { status: 'account', message: service === 'sites' ? 'Account verified. Modern Sites supports web access only.' : 'Account verified. Google Maps opens with this account; Maps Platform APIs require separate project setup.' }
  if (product.mode === 'cloud' && !settings.cloudProject) throw new Error(service === 'notebooklm' ? 'Add a Google Cloud project with NotebookLM Enterprise enabled.' : 'Add a Google Cloud project with Cloud Translation enabled.')
  // The location becomes part of the hostname the bearer token is sent to, and
  // stored settings can be stale or edited — re-check it before any token is issued.
  if (service === 'notebooklm' && !NOTEBOOK_LOCATIONS.includes(settings.notebookLocation)) throw new Error('Choose a NotebookLM location.')
  const token = await authorizeGoogle(account, product.scopes, settings.clientId)
  const endpoints: Partial<Record<GoogleService, string>> = {
    gmail: 'https://gmail.googleapis.com/gmail/v1/users/me/profile', drive: 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
    calendar: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', chat: 'https://chat.googleapis.com/v1/spaces?pageSize=1',
    meet: 'https://meet.googleapis.com/v2/conferenceRecords?pageSize=1', keep: 'https://keep.googleapis.com/v1/notes?pageSize=1',
    tasks: 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1',
    translate: 'https://translation.googleapis.com/language/translate/v2/languages?target=en',
    notebooklm: `https://${settings.notebookLocation}-discoveryengine.googleapis.com/v1alpha/projects/${encodeURIComponent(settings.cloudProject)}/locations/${settings.notebookLocation}/notebooks:listRecentlyViewed?pageSize=1`,
  }
  if (service === 'docs' || service === 'sheets') {
    let id = service === 'docs' ? settings.docsId : settings.sheetsId
    if (!id) {
      const mime = service === 'docs' ? 'application/vnd.google-apps.document' : 'application/vnd.google-apps.spreadsheet'
      const query = new URLSearchParams({ q: `mimeType='${mime}' and trashed=false`, fields: 'files(id)', pageSize: '1' })
      const files = await googleApiRequest<{ files: { id: string }[] }>(`https://www.googleapis.com/drive/v3/files?${query}`, token)
      id = files.files[0]?.id ?? ''
    }
    assertGoogleAccount(account)
    if (!id) return { status: 'authorized', message: `Permission granted. Add a test ${service === 'docs' ? 'document' : 'spreadsheet'} ID to verify its API.` }
    endpoints[service] = service === 'docs' ? `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?fields=documentId` : `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=spreadsheetId`
  }
  await googleApiRequest(endpoints[service]!, token, product.mode === 'cloud' ? settings.cloudProject : undefined)
  assertGoogleAccount(account)
  return { status: 'verified', message: `${product.name} API verified for ${account.email}.` }
}

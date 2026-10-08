export const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const API = 'https://www.googleapis.com/drive/v3'
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,appProperties,capabilities(canEdit,canTrash,canAddChildren)'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
  webViewLink?: string
  appProperties?: Record<string, string>
  capabilities?: { canEdit?: boolean; canTrash?: boolean; canAddChildren?: boolean }
}

export interface DriveSession {
  accessToken: string
  expiresAt: number
  email: string
}
interface TokenResponse { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
interface GoogleIdentity {
  accounts: { oauth2: {
    initTokenClient: (config: {
      client_id: string; scope: string; callback: (response: TokenResponse) => void
      error_callback: (error: { type: string }) => void
    }) => { requestAccessToken: (config: { prompt: string }) => void }
  } }
}

let identityPromise: Promise<GoogleIdentity> | undefined
const sessions = new Map<string, DriveSession>()
function notifySession() { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('goms:dms-session-changed')) }
const identity = () => (window as Window & { google?: GoogleIdentity }).google

/** Public OAuth client ID only. Access tokens stay in memory, never device storage. */
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const loaded = identity()
  if (loaded) return Promise.resolve(loaded)
  if (identityPromise) return identityPromise
  identityPromise = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    const timer = window.setTimeout(() => fail(), 15000)
    function fail() {
      window.clearTimeout(timer)
      script.remove()
      identityPromise = undefined
      reject(new Error('Google sign-in could not load. Check your connection and retry.'))
    }
    script.onerror = fail
    script.onload = () => {
      window.clearTimeout(timer)
      const google = identity()
      if (google) resolve(google)
      else fail()
    }
    document.head.appendChild(script)
  })
  return identityPromise
}

export function getDriveSession(connectionId = 'default'): DriveSession | null {
  const session = sessions.get(connectionId)
  if (session && session.expiresAt <= Date.now()) { sessions.delete(connectionId); return null }
  return session ?? null
}

export function disconnectDrive(connectionId = 'default'): void { sessions.delete(connectionId); notifySession() }

/** Called synchronously from a click, after loading GIS, to preserve popup permission. */
export function connectDrive(clientId: string, connectionId = 'default'): Promise<DriveSession> {
  const google = identity()
  if (!google) return Promise.reject(new Error('Google sign-in is still loading. Try again.'))
  if (!clientId) return Promise.reject(new Error('Save a Google OAuth client ID before connecting.'))
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      error_callback: (error) => reject(new Error(error.type === 'popup_closed' ? 'Google sign-in was cancelled.' : 'Allow the Google sign-in popup and try again.')),
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? 'Google Drive access was not granted.'))
          return
        }
        if (!response.scope?.split(' ').includes(DRIVE_SCOPE)) {
          reject(new Error('Google Drive permission is required to manage documents.'))
          return
        }
        const session = { accessToken: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000, email: '' }
        sessions.set(connectionId, session)
        driveRequest<{ user: { emailAddress: string } }>('/about?fields=user(emailAddress)', undefined, connectionId)
          .then((result) => {
            if (sessions.get(connectionId) !== session) throw new Error('The connection was closed. Try again.')
            session.email = result.user.emailAddress
            notifySession()
            resolve({ ...session })
          })
          .catch((error) => { disconnectDrive(connectionId); reject(error) })
      },
    })
    client.requestAccessToken({ prompt: 'select_account' })
  })
}

async function checkResponse(response: Response, connectionId: string): Promise<Response> {
  if (response.ok) return response
  if (response.status === 401) {
    disconnectDrive(connectionId)
    throw new Error('Your Google Drive session has expired. Reconnect to continue.')
  }
  const payload = await response.json().catch(() => null)
  throw new Error(payload?.error?.message ?? `Google Drive request failed (${response.status}).`)
}

async function authenticatedFetch(url: string, init: RequestInit = {}, connectionId = 'default'): Promise<Response> {
  const current = getDriveSession(connectionId)
  if (!current) throw new Error('Connect Google Drive to continue.')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${current.accessToken}`)
  return checkResponse(await fetch(url, { ...init, headers }), connectionId)
}

async function driveRequest<T>(path: string, init?: RequestInit, connectionId = 'default'): Promise<T> {
  const response = await authenticatedFetch(`${API}${path}`, init, connectionId)
  return response.json() as Promise<T>
}

export async function getFolder(id: string, connectionId = 'default'): Promise<DriveFile> {
  const file = await driveRequest<DriveFile>(`/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${FILE_FIELDS},trashed`, undefined, connectionId)
  if (file.mimeType !== FOLDER_MIME || (file as DriveFile & { trashed?: boolean }).trashed) {
    throw new Error('Choose an existing Google Drive folder that is not in the trash.')
  }
  return file
}

export async function listFiles(folderId: string, connectionId = 'default'): Promise<DriveFile[]> {
  const escapedId = folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const query = new URLSearchParams({
      q: `'${escapedId}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      orderBy: 'folder,name', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    })
    const result = await driveRequest<{ files: DriveFile[]; nextPageToken?: string }>(`/files?${query}`, undefined, connectionId)
    files.push(...result.files)
    pageToken = result.nextPageToken
  } while (pageToken)
  return files
}

export function createFolder(name: string, parentId?: string, connectionId = 'default', appProperties?: Record<string, string>): Promise<DriveFile> {
  return driveRequest(`/files?supportsAllDrives=true&fields=${FILE_FIELDS}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}), ...(appProperties ? { appProperties } : {}) }),
  }, connectionId)
}

export function renameFile(id: string, name: string, connectionId = 'default'): Promise<DriveFile> {
  return driveRequest(`/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${FILE_FIELDS}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }, connectionId)
}

export function trashFile(id: string, connectionId = 'default'): Promise<{ id: string }> {
  return driveRequest(`/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  }, connectionId)
}

/** A replacement uploads a new Drive revision to the existing file. */
export async function uploadFile(file: File, parentId: string, category: string, replaceId?: string, connectionId = 'default'): Promise<DriveFile> {
  const contentType = file.type || 'application/octet-stream'
  const path = replaceId ? `/${encodeURIComponent(replaceId)}` : ''
  const response = await authenticatedFetch(`https://www.googleapis.com/upload/drive/v3/files${path}?uploadType=resumable&supportsAllDrives=true&fields=${FILE_FIELDS}`, {
    method: replaceId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': contentType, 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ ...(replaceId ? {} : { name: file.name, parents: [parentId] }), appProperties: { category } }),
  }, connectionId)
  const location = response.headers.get('Location')
  if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw new Error('Google Drive did not return a valid upload session.')
  const uploaded = await authenticatedFetch(location, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file }, connectionId)
  return uploaded.json() as Promise<DriveFile>
}

export function copyFile(source: DriveFile, parentId: string, connectionId: string, appProperties: Record<string, string>): Promise<DriveFile> {
  return driveRequest(`/files/${encodeURIComponent(source.id)}/copy?supportsAllDrives=true&fields=${FILE_FIELDS}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: source.name, parents: [parentId], appProperties: { ...source.appProperties, ...appProperties } }),
  }, connectionId)
}

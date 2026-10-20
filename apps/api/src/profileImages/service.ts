import { randomUUID } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { inTransaction } from '../lib/rbacTreeStore.js'
import { emailConfiguration, openEmailCredentials, sealEmailCredentials, type SealedEmailCredentials } from '../email/config.js'
import { isProfileImage, mapProfileImages, type ProfileFile, type ProfileMapping, type ProfilePerson } from './mapping.js'

// System-scoped metadata in the existing settings store; image bytes live only in Drive and transient HTTP caches.
export const PROFILE_SETTINGS_KEY = 'system:profile-images:v1'
export const PROFILE_CREDENTIAL_BINDING = 'goms:profile-images:v1'
export interface ProfileState {
  folderId: string; folderName: string; driveId?: string; accountEmail: string; credentials?: SealedEmailCredentials
  revision: string; pageToken?: string; files: ProfileFile[]; mappings: Record<string, ProfileMapping>
  lastSyncAt: string | null; lastAttemptAt?: string; error: string | null; warnings: string[]
}
const empty = (): ProfileState => ({ folderId: '', folderName: '', accountEmail: '', revision: '', files: [], mappings: {}, lastSyncAt: null, error: null, warnings: [] })
type Db = Pick<PoolClient, 'query'>
export async function readProfileState(db: Db = pool): Promise<ProfileState> {
  return (await db.query('SELECT settings FROM google_integration_settings WHERE user_uid=$1', [PROFILE_SETTINGS_KEY])).rows[0]?.settings ?? empty()
}
export async function readProfileIndex(): Promise<Pick<ProfileState, 'folderId' | 'error' | 'revision' | 'mappings'>> {
  return (await pool.query("SELECT settings - 'files' - 'credentials' - 'warnings' AS settings FROM google_integration_settings WHERE user_uid=$1", [PROFILE_SETTINGS_KEY])).rows[0]?.settings ?? empty()
}
export async function readProfileImage(userId: string): Promise<Pick<ProfileState, 'folderId' | 'error' | 'credentials'> & { mapping?: ProfileMapping }> {
  // Extract just this mapping in PostgreSQL. A thumbnail request never transfers the entire Drive index.
  return (await pool.query("SELECT settings - 'files' - 'mappings' - 'warnings' || jsonb_build_object('mapping',settings->'mappings'->$2::text) AS settings FROM google_integration_settings WHERE user_uid=$1", [PROFILE_SETTINGS_KEY, userId])).rows[0]?.settings ?? { folderId: '', error: null }
}
export async function writeProfileState(db: Db, state: ProfileState) {
  await db.query(`INSERT INTO google_integration_settings(user_uid,email,settings) VALUES($1,$2,$3)
    ON CONFLICT(user_uid) DO UPDATE SET email=EXCLUDED.email,settings=EXCLUDED.settings,updated_at=now()`, [PROFILE_SETTINGS_KEY, state.accountEmail, JSON.stringify(state)])
}
export async function withProfileLock<T>(fn: (state: ProfileState, db: PoolClient) => Promise<T>) {
  return inTransaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [PROFILE_SETTINGS_KEY])
    return fn(await readProfileState(db), db)
  })
}
export function profileStatus(state: ProfileState) {
  return { folderId: state.folderId, folderName: state.folderName, accountEmail: state.accountEmail, revision: state.revision,
    status: state.error ? 'error' as const : state.credentials ? 'connected' as const : 'disconnected' as const,
    lastSyncAt: state.lastSyncAt, imageCount: state.files.length, matchedCount: Object.keys(state.mappings).length,
    error: state.error, warnings: state.warnings, oauthReady: emailConfiguration().ready }
}
export class DriveError extends Error {
  constructor(readonly status: number) { super(status === 401 ? 'Google Drive authorization expired. Reconnect Google Drive.' : status === 403 ? 'Google Drive access denied. Check folder permissions and the Drive API.' : status === 404 ? 'Google Drive folder or image is unavailable to the connected account.' : `Google Drive is temporarily unavailable (HTTP ${status}).`) }
}
export const syncError = (error: unknown) => error instanceof DriveError ? error.message : 'Profile image synchronization failed. Check the server connection and reconnect Google Drive if needed.'
export async function profileToken(state: ProfileState): Promise<string> {
  if (!state.credentials) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Connect Google Drive for Profile Images first.' })
  let credentials = openEmailCredentials(state.credentials, PROFILE_CREDENTIAL_BINDING)
  if (credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken
  const cfg = emailConfiguration()
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }), redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new DriveError(response.status === 400 ? 401 : response.status)
  const result = await response.json() as { access_token: string; expires_in: number; refresh_token?: string }
  if (!result.access_token || !Number.isFinite(result.expires_in)) throw new DriveError(502)
  credentials = { accessToken: result.access_token, refreshToken: result.refresh_token || credentials.refreshToken, expiresAt: Date.now() + Math.min(result.expires_in, 3600) * 1000 }
  state.credentials = sealEmailCredentials(credentials, PROFILE_CREDENTIAL_BINDING)
  return credentials.accessToken
}
export async function driveJson<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new DriveError(response.status)
  return response.json() as Promise<T>
}
export async function profileFolder(token: string, id: string) {
  const folder = await driveJson<{ id: string; name: string; mimeType: string; trashed?: boolean; driveId?: string }>(token, `files/${encodeURIComponent(id)}`, { supportsAllDrives: 'true', fields: 'id,name,mimeType,trashed,driveId' })
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') throw new DriveError(404)
  return folder
}
const fields = 'id,name,mimeType,parents,trashed,version,modifiedTime,md5Checksum'
/** Build a complete candidate index before replacing the committed index/cursor. No per-person Drive calls. */
export async function updateProfileIndex(state: ProfileState, token: string, people: ProfilePerson[]) {
  const folder = await profileFolder(token, state.folderId)
  const shared: Record<string, string> = folder.driveId ? { driveId: folder.driveId } : {}
  let pageToken = state.pageToken; let files = new Map(state.files.map(file => [file.id, file]))
  if (!pageToken || state.driveId !== folder.driveId) {
    const start = await driveJson<{ startPageToken: string }>(token, 'changes/startPageToken', { supportsAllDrives: 'true', ...shared })
    pageToken = start.startPageToken; files = new Map()
    let next = ''
    do {
      const page = await driveJson<{ files: ProfileFile[]; nextPageToken?: string; incompleteSearch?: boolean }>(token, 'files', {
        q: `'${state.folderId}' in parents and trashed=false and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp')`,
        pageSize: '1000', fields: `nextPageToken,incompleteSearch,files(${fields})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
        ...(folder.driveId ? { corpora: 'drive', ...shared } : {}), ...(next ? { pageToken: next } : {}),
      })
      if (page.incompleteSearch) throw new DriveError(503)
      for (const file of page.files ?? []) if (isProfileImage(file)) files.set(file.id, file)
      if (files.size > 50_000) throw new DriveError(413)
      next = page.nextPageToken ?? ''
    } while (next)
  } else {
    let next = pageToken; let pages = 0
    do {
      const page = await driveJson<{ changes: { fileId: string; removed?: boolean; file?: ProfileFile }[]; nextPageToken?: string; newStartPageToken?: string }>(token, 'changes', {
        pageToken: next, pageSize: '1000', fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${fields}))`,
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', includeRemoved: 'true', ...shared,
      })
      for (const change of page.changes ?? []) {
        const file = change.file
        if (change.removed || !file || !file.parents?.includes(state.folderId) || !isProfileImage(file)) files.delete(change.fileId)
        else files.set(file.id, file)
      }
      if (++pages > 1000 || files.size > 50_000) throw new DriveError(413)
      next = page.nextPageToken ?? ''; if (!next) pageToken = page.newStartPageToken ?? pageToken
    } while (next)
  }
  const indexed = [...files.values()]; const { mappings, errors } = mapProfileImages(state.folderId, indexed, people)
  const changed = state.error || JSON.stringify(mappings) !== JSON.stringify(state.mappings)
  Object.assign(state, { folderName: folder.name, driveId: folder.driveId, files: indexed, mappings, pageToken,
    lastSyncAt: new Date().toISOString(), error: null, warnings: errors, ...(changed ? { revision: randomUUID() } : {}) })
}
export async function syncProfileImages(folderId?: string, onlyIfDue = false) {
  return withProfileLock(async (state, db) => {
    if (onlyIfDue && state.lastAttemptAt && Date.now() - Date.parse(state.lastAttemptAt) < 55_000) return profileStatus(state)
    if (folderId !== undefined && folderId !== state.folderId) {
      Object.assign(state, { folderId, folderName: '', driveId: undefined, pageToken: undefined, files: [], mappings: {}, lastSyncAt: null, error: null, warnings: [], revision: randomUUID() })
      clearProfileByteCache()
    }
    if (state.folderId && state.credentials) {
      state.lastAttemptAt = new Date().toISOString()
      try {
        const token = await profileToken(state)
        const people = (await db.query('SELECT id,name,email,code FROM employees WHERE vacant=false')).rows as ProfilePerson[]
        await updateProfileIndex(state, token, people)
      } catch (error) {
        state.error = syncError(error); state.revision = randomUUID(); clearProfileByteCache()
        // Losing folder access invalidates all mappings. Transient failures retain the cursor for a safe retry.
        if (error instanceof DriveError && [401, 403, 404].includes(error.status)) { state.mappings = {}; state.files = []; state.pageToken = undefined }
      }
    }
    await writeProfileState(db, state)
    return profileStatus(state)
  })
}
export function startProfileImageSynchronizer() {
  let running = false
  const tick = async () => {
    if (running || process.env.EMERGENCY_READ_ONLY === 'true') return
    running = true
    try {
      const state = await readProfileState()
      if (state.folderId && state.credentials && (!state.lastAttemptAt || Date.now() - Date.parse(state.lastAttemptAt) >= 55_000)) await syncProfileImages(undefined, true)
    } catch { /* The next tick retries; persisted provider errors are visible in DMS. */ }
    finally { running = false }
  }
  const timer = setInterval(tick, 60_000); timer.unref(); void tick()
  return () => clearInterval(timer)
}

type PhotoBytes = { body: Buffer; mime: string }
const byteCache = new Map<string, PhotoBytes>(); const pending = new Map<string, Promise<PhotoBytes>>()
let byteCount = 0; let cacheGeneration = 0
export function clearProfileByteCache() { byteCache.clear(); byteCount = 0; cacheGeneration++ }
async function imageBytes(response: Response): Promise<PhotoBytes> {
  if (!response.ok) throw new DriveError(response.status)
  const mime = response.headers.get('Content-Type')?.split(';')[0] ?? ''
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new DriveError(415)
  const reader = response.body?.getReader(); if (!reader) throw new DriveError(502)
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break
      size += chunk.value.length; if (size > 8 * 1024 * 1024) throw new DriveError(413)
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel() }
  return { body: Buffer.concat(chunks), mime }
}
export async function profilePhoto(state: Pick<ProfileState, 'folderId' | 'credentials'>, mapping: ProfileMapping): Promise<PhotoBytes> {
  const cached = byteCache.get(mapping.version)
  if (cached) { byteCache.delete(mapping.version); byteCache.set(mapping.version, cached); return cached }
  const existing = pending.get(mapping.version); if (existing) return existing
  const generation = cacheGeneration
  const work = (async () => {
    const saved = state.credentials ? openEmailCredentials(state.credentials, PROFILE_CREDENTIAL_BINDING) : null
    const token = saved && saved.expiresAt > Date.now() + 60_000 ? saved.accessToken : await withProfileLock(async (current, db) => {
      if (current.folderId !== state.folderId || current.error || !Object.values(current.mappings).some(item => item.version === mapping.version)) throw new DriveError(404)
      const value = await profileToken(current); await writeProfileState(db, current); return value
    })
    const file = await driveJson<{ thumbnailLink?: string; parents?: string[]; trashed?: boolean }>(token, `files/${encodeURIComponent(mapping.fileId)}`, { supportsAllDrives: 'true', fields: 'thumbnailLink,parents,trashed' })
    if (file.trashed || !file.parents?.includes(state.folderId)) throw new DriveError(404)
    const options = { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' as const, signal: AbortSignal.timeout(15_000) }
    let photo: PhotoBytes | undefined
    if (file.thumbnailLink) {
      const url = new URL(file.thumbnailLink)
      if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))) {
        url.pathname = url.pathname.replace(/=s\d+$/, '=s96')
        const response = await fetch(url, options)
        if (response.ok) photo = await imageBytes(response)
        else if (![403, 404].includes(response.status)) throw new DriveError(response.status)
      }
    }
    photo ??= await imageBytes(await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(mapping.fileId)}?alt=media&supportsAllDrives=true`, options))
    if (generation === cacheGeneration) {
      while (byteCount + photo.body.length > 16 * 1024 * 1024 && byteCache.size) {
        const oldest = byteCache.keys().next().value!; byteCount -= byteCache.get(oldest)!.body.length; byteCache.delete(oldest)
      }
      byteCache.set(mapping.version, photo); byteCount += photo.body.length
    }
    return photo
  })()
  pending.set(mapping.version, work)
  try { return await work } finally { pending.delete(mapping.version) }
}

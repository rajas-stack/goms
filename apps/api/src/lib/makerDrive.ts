// Document maker → each owner's own Google Drive. The employee connects once through the server Google OAuth client
// (same single-use flow store and sealing as Email Center / Profile Images) with scope drive.file, so GOMS can only
// see files it created. After every saved version the file is uploaded over the same Drive file in a
// "GOMS Documents" folder. A failed upload never fails the save: the error is kept on the connection and shown.
import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import { TRPCError } from '@trpc/server'
import { downloadName, MIME_FOR_FILE_TYPE, type MakerDriveStatus, type MakerFileType } from '@goms/domain'
import { pool } from '../db.js'
import { mailOAuthGateway, type MailOAuthGateway } from '../email/oauth.js'
import { emailConfiguration, openEmailCredentials, sealEmailCredentials, type EmailCredentials, type SealedEmailCredentials } from '../email/config.js'

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER_NAME = 'GOMS Documents'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const STATE = /^mdrive\.[\w-]{43}$/

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const random = () => randomBytes(32).toString('base64url')
const binding = (email: string) => `maker-drive:${email}`
const cookieName = (state: string) => `goms_mdrive_${digest(state).slice(0, 16)}`
const cookie = (state: string, value: string, expired = false) => `${cookieName(state)}=${value}; HttpOnly; SameSite=Lax; Path=/api/oauth/google/callback; Max-Age=${expired ? 0 : 600}${emailConfiguration().origin.startsWith('https:') ? '; Secure' : ''}`

export const isMakerDriveState = (state: unknown) => typeof state === 'string' && state.startsWith('mdrive.')

export class DriveSyncError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? 'Google Drive access expired. Reconnect Google Drive.' : status === 403 ? 'Google Drive refused the upload (storage full or the Drive API is off).' : `Google Drive is temporarily unavailable (HTTP ${status}).`)
  }
}

export async function beginDriveConnection(user: { uid: string; email: string }, setCookie?: (value: string) => void) {
  const cfg = emailConfiguration()
  if (!cfg.ready) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Google Drive upload is not set up on the server yet (Google OAuth client, callback and encryption key).' })
  if (!setCookie) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Open Document maker in a browser to connect Google Drive.' })
  const state = `mdrive.${random()}`; const verifier = random(); const nonce = random(); const browser = random()
  await pool.query('DELETE FROM email_oauth_flows WHERE expires_at<now()')
  await pool.query(`INSERT INTO email_oauth_flows(state_hash,cookie_hash,verifier,nonce,user_uid,email,return_to,expires_at) VALUES($1,$2,$3,$4,$5,$6,'/document-maker',now()+interval '10 minutes')`,
    [digest(state), digest(browser), verifier, nonce, user.uid, user.email.toLowerCase()])
  setCookie(cookie(state, browser))
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: `openid email ${DRIVE_FILE_SCOPE}`, state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', login_hint: user.email, hd: 'amnex.com' }).toString()
  return { url: url.toString() }
}

export async function completeDriveConnection(req: { query?: any; headers: { cookie?: string } }, reply: FastifyReply, gateway: MailOAuthGateway = mailOAuthGateway) {
  const state = req.query?.state
  reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
  if (typeof state !== 'string' || !STATE.test(state)) return reply.code(400).send({ error: 'Invalid Google Drive connection.' })
  const browser = (req.headers.cookie ?? '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName(state)}=`))?.split('=')[1] ?? ''
  const flow = (await pool.query('DELETE FROM email_oauth_flows WHERE state_hash=$1 AND cookie_hash=$2 AND expires_at>now() RETURNING *', [digest(state), digest(browser)])).rows[0]
  reply.header('Set-Cookie', cookie(state, '', true))
  if (!flow) return reply.code(400).send({ error: 'Connection expired or does not belong to this browser. Connect again from Document maker.' })
  const redirect = (result: string) => reply.code(302).header('Location', `${emailConfiguration().origin}/document-maker?drive_connection=${result}`).send()
  if (req.query?.error) return redirect('cancelled')
  if (typeof req.query?.code !== 'string' || req.query.code.length > 2048) return redirect('failed')
  try {
    const grant = await gateway.exchange(req.query.code, flow.verifier)
    const claims = await gateway.verify(grant.id_token, flow.nonce)
    // Files go to the signed-in employee's own Drive, never another account's.
    if (claims.email !== flow.email || !grant.scope.split(' ').includes(DRIVE_FILE_SCOPE)) return redirect('wrong_account_or_permission')
    const previous = (await pool.query('SELECT credentials FROM maker_drive_connections WHERE email=$1', [flow.email])).rows[0]
    const refreshToken = grant.refresh_token || (previous ? openEmailCredentials(previous.credentials, binding(flow.email)).refreshToken : '')
    if (!refreshToken) return redirect('failed')
    const sealed = sealEmailCredentials({ accessToken: grant.access_token, refreshToken, expiresAt: Date.now() + Math.min(Math.max(grant.expires_in, 0), 3600) * 1000 }, binding(flow.email))
    await pool.query(`INSERT INTO maker_drive_connections (email, credentials) VALUES ($1,$2)
      ON CONFLICT (email) DO UPDATE SET credentials=EXCLUDED.credentials, last_error=NULL, connected_at=now()`, [flow.email, sealed])
    void syncAllOwned(flow.email)
    return redirect('connected')
  } catch { return redirect('failed') }
}

export async function driveStatus(email: string): Promise<MakerDriveStatus> {
  const { rows } = await pool.query('SELECT folder_id, last_error, last_sync_at FROM maker_drive_connections WHERE email=$1', [email])
  const row = rows[0]
  return {
    configured: emailConfiguration().ready, connected: !!row,
    lastSyncAt: row?.last_sync_at ? new Date(row.last_sync_at).toISOString() : null, lastError: row?.last_error ?? null,
    folderUrl: row?.folder_id ? `https://drive.google.com/drive/folders/${encodeURIComponent(row.folder_id)}` : null,
  }
}

/** Forgets the connection; files already in the employee's Drive stay there (they are theirs). */
export async function disconnectDrive(email: string): Promise<void> {
  const { rows } = await pool.query('DELETE FROM maker_drive_connections WHERE email=$1 RETURNING credentials', [email])
  if (!rows[0]) return
  try {
    const { refreshToken } = openEmailCredentials(rows[0].credentials, binding(email))
    await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }), redirect: 'error', signal: AbortSignal.timeout(10_000) })
  } catch { /* The stored token is already gone; revocation is best effort. */ }
}

export interface DriveDeps { fetchImpl: typeof fetch }

async function accessToken(email: string, sealed: SealedEmailCredentials, deps: DriveDeps): Promise<string> {
  let credentials: EmailCredentials = openEmailCredentials(sealed, binding(email))
  if (credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken
  const cfg = emailConfiguration()
  const response = await deps.fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }), redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new DriveSyncError(response.status === 400 ? 401 : response.status)
  const result = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string }
  if (!result.access_token || !Number.isFinite(result.expires_in)) throw new DriveSyncError(502)
  credentials = { accessToken: result.access_token, refreshToken: result.refresh_token || credentials.refreshToken, expiresAt: Date.now() + Math.min(result.expires_in!, 3600) * 1000 }
  await pool.query('UPDATE maker_drive_connections SET credentials=$2 WHERE email=$1', [email, sealEmailCredentials(credentials, binding(email))])
  return credentials.accessToken
}

async function drive<T>(deps: DriveDeps, token: string, url: string, init: RequestInit): Promise<T> {
  const response = await deps.fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new DriveSyncError(response.status)
  return response.json() as Promise<T>
}

function multipart(metadata: object, bytes: Uint8Array, mime: string): { body: Uint8Array<ArrayBuffer>; type: string } {
  const boundary = `goms${randomBytes(12).toString('hex')}`
  const body = new Uint8Array(Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--`),
  ]))
  return { body, type: `multipart/related; boundary=${boundary}` }
}

async function ensureFolder(email: string, folderId: string | null, token: string, deps: DriveDeps): Promise<string> {
  if (folderId) return folderId
  const folder = await drive<{ id: string }>(deps, token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  })
  await pool.query('UPDATE maker_drive_connections SET folder_id=$2 WHERE email=$1', [email, folder.id])
  return folder.id
}

/** Uploads the current version of one file to its owner's Drive, if they connected one. */
export async function syncDocumentToDrive(id: string, deps: DriveDeps = { fetchImpl: fetch }): Promise<'synced' | 'skipped'> {
  const { rows } = await pool.query(
    `SELECT d.title, d.file_type, d.version, d.content, d.owner_email, c.credentials, c.folder_id, f.drive_file_id, f.version AS synced_version
     FROM maker_documents d JOIN maker_drive_connections c ON c.email=d.owner_email
     LEFT JOIN maker_drive_files f ON f.document_id=d.id WHERE d.id=$1`, [id])
  const row = rows[0]
  if (!row || Number(row.synced_version) === Number(row.version)) return 'skipped'
  const email: string = row.owner_email
  try {
    const token = await accessToken(email, row.credentials, deps)
    const fileType = row.file_type as MakerFileType
    const name = downloadName({ title: row.title, fileType })
    const mime = MIME_FOR_FILE_TYPE[fileType]
    let fileId: string | null = row.drive_file_id
    if (fileId) {
      try {
        const { body, type } = multipart({ name }, row.content, mime)
        await drive(deps, token, `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`, { method: 'PATCH', headers: { 'Content-Type': type }, body })
      } catch (error) {
        // Deleted from Drive by the employee: upload it again as a new file.
        if (!(error instanceof DriveSyncError && error.status === 404)) throw error
        fileId = null
      }
    }
    if (!fileId) {
      let folder = await ensureFolder(email, row.folder_id, token, deps)
      const create = async () => {
        const { body, type } = multipart({ name, parents: [folder] }, row.content, mime)
        return drive<{ id: string }>(deps, token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': type }, body })
      }
      let created: { id: string }
      try { created = await create() } catch (error) {
        if (!(error instanceof DriveSyncError && error.status === 404)) throw error
        folder = await ensureFolder(email, null, token, deps) // The folder was deleted from Drive.
        created = await create()
      }
      fileId = created.id
    }
    await pool.query(`INSERT INTO maker_drive_files (document_id, drive_file_id, version) VALUES ($1,$2,$3)
      ON CONFLICT (document_id) DO UPDATE SET drive_file_id=EXCLUDED.drive_file_id, version=EXCLUDED.version, synced_at=now()`, [id, fileId, row.version])
    await pool.query('UPDATE maker_drive_connections SET last_error=NULL, last_sync_at=now() WHERE email=$1', [email])
    return 'synced'
  } catch (error) {
    const message = error instanceof DriveSyncError ? error.message : 'Upload to Google Drive failed. It will be retried on the next save.'
    await pool.query('UPDATE maker_drive_connections SET last_error=$2 WHERE email=$1', [email, message])
    throw error
  }
}

// One upload per file at a time, so two quick saves cannot create the Drive file twice.
// shortcut: the queue is per process; on several API instances two uploads of one file could race. Use a row lock then.
const queue = new Map<string, Promise<unknown>>()

/** Fire-and-forget upload after a save; errors are recorded on the connection, never thrown to the saver. */
export function queueDriveSync(id: string): void {
  const next = (queue.get(id) ?? Promise.resolve()).then(() => syncDocumentToDrive(id)).catch(() => undefined)
    .finally(() => { if (queue.get(id) === next) queue.delete(id) })
  queue.set(id, next)
}

/** Right after connecting: upload every file the employee owns. */
export async function syncAllOwned(email: string): Promise<void> {
  const { rows } = await pool.query('SELECT id FROM maker_documents WHERE owner_email=$1 ORDER BY updated_at DESC LIMIT 1000', [email])
  for (const { id } of rows) queueDriveSync(id)
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
import { sealEmailCredentials } from '../email/config.js'
import { completeDriveConnection, DRIVE_FILE_SCOPE, syncDocumentToDrive } from './makerDrive.js'

const ENV = {
  EMAIL_TOKEN_ENCRYPTION_KEY: 'drive-test-encryption-key-0123456789abcdef', EMAIL_GOOGLE_CLIENT_ID: 'client', EMAIL_GOOGLE_CLIENT_SECRET: 'secret',
  EMAIL_GOOGLE_REDIRECT_URI: 'http://localhost:8787/api/oauth/google/callback',
}
const id = '11111111-2222-4333-8444-555555555555'
const email = 'writer@amnex.com'
const sealed = (expiresAt: number) => sealEmailCredentials({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt }, `maker-drive:${email}`)

function docRow(over: Record<string, unknown> = {}) {
  return { title: 'Plan', file_type: 'docx', version: 3, content: Buffer.from('PK\x03\x04data'), owner_email: email, credentials: sealed(Date.now() + 3_600_000), folder_id: null, drive_file_id: null, synced_version: null, ...over }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const calls = (fetchImpl: ReturnType<typeof vi.fn>) => fetchImpl.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url).split('?')[0]}`)
const sqlWith = (text: string) => db.query.mock.calls.filter((c) => String(c[0]).includes(text))

describe('Document maker → Google Drive', () => {
  beforeEach(() => { vi.clearAllMocks(); Object.assign(process.env, ENV) })
  afterEach(() => { for (const name of Object.keys(ENV)) delete process.env[name] })

  it('creates the folder and the file on first upload, and records the synced version', async () => {
    db.query.mockImplementation(async (text: string) => ({ rows: text.includes('FROM maker_documents d') ? [docRow()] : [] }))
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ id: 'folder-1' })).mockResolvedValueOnce(json({ id: 'file-1' }))
    expect(await syncDocumentToDrive(id, { fetchImpl })).toBe('synced')
    expect(calls(fetchImpl)).toEqual(['POST https://www.googleapis.com/drive/v3/files', 'POST https://www.googleapis.com/upload/drive/v3/files'])
    const upload = Buffer.from(fetchImpl.mock.calls[1][1].body).toString()
    expect(upload).toContain('"name":"Plan.docx"')
    expect(upload).toContain('"parents":["folder-1"]')
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer access-1')
    expect(sqlWith('INSERT INTO maker_drive_files')[0][1]).toEqual([id, 'file-1', 3])
    expect(sqlWith('last_error=NULL')).toHaveLength(1)
  })

  it('updates the same Drive file on later saves and skips versions already uploaded', async () => {
    db.query.mockImplementation(async (text: string) => ({ rows: text.includes('FROM maker_documents d') ? [docRow({ folder_id: 'folder-1', drive_file_id: 'file-1', synced_version: 2 })] : [] }))
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: 'file-1' }))
    await syncDocumentToDrive(id, { fetchImpl })
    expect(calls(fetchImpl)).toEqual(['PATCH https://www.googleapis.com/upload/drive/v3/files/file-1'])

    db.query.mockImplementation(async (text: string) => ({ rows: text.includes('FROM maker_documents d') ? [docRow({ drive_file_id: 'file-1', synced_version: 3 })] : [] }))
    expect(await syncDocumentToDrive(id, { fetchImpl })).toBe('skipped')
    db.query.mockImplementation(async () => ({ rows: [] })) // owner never connected Drive
    expect(await syncDocumentToDrive(id, { fetchImpl })).toBe('skipped')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('re-creates a file or folder the employee deleted from Drive', async () => {
    db.query.mockImplementation(async (text: string) => ({ rows: text.includes('FROM maker_documents d') ? [docRow({ folder_id: 'gone-folder', drive_file_id: 'gone-file', synced_version: 2 })] : [] }))
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: {} }, 404)) // PATCH the deleted file
      .mockResolvedValueOnce(json({ error: {} }, 404)) // create inside the deleted folder
      .mockResolvedValueOnce(json({ id: 'folder-2' }))
      .mockResolvedValueOnce(json({ id: 'file-2' }))
    await syncDocumentToDrive(id, { fetchImpl })
    expect(sqlWith('INSERT INTO maker_drive_files')[0][1]).toEqual([id, 'file-2', 3])
    expect(sqlWith('SET folder_id=$2')[0][1]).toEqual([email, 'folder-2'])
  })

  it('refreshes an expired token and stores the new one sealed', async () => {
    db.query.mockImplementation(async (text: string) => ({ rows: text.includes('FROM maker_documents d') ? [docRow({ credentials: sealed(Date.now() - 1000), folder_id: 'f', drive_file_id: 'file-1', synced_version: 1 })] : [] }))
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ access_token: 'access-2', expires_in: 3600 })).mockResolvedValueOnce(json({ id: 'file-1' }))
    await syncDocumentToDrive(id, { fetchImpl })
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer access-2')
    const stored = sqlWith('SET credentials=$2')[0][1] as unknown[]
    expect(JSON.stringify(stored)).not.toContain('access-2')
  })

  it('records a friendly error and rethrows when Drive refuses', async () => {
    db.query.mockImplementation(async (text: string) => ({ rows: text.includes('FROM maker_documents d') ? [docRow({ folder_id: 'f', drive_file_id: 'file-1', synced_version: 1 })] : [] }))
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: {} }, 403))
    await expect(syncDocumentToDrive(id, { fetchImpl })).rejects.toThrow('refused')
    expect(sqlWith('SET last_error=$2')[0][1]).toEqual([email, expect.stringContaining('refused')])
    expect(sqlWith('INSERT INTO maker_drive_files')).toHaveLength(0)
  })

  it('refuses a Drive connection made with another Google account', async () => {
    const state = `mdrive.${'a'.repeat(43)}`
    db.query.mockImplementation(async (text: string) => ({ rows: text.startsWith('DELETE FROM email_oauth_flows') ? [{ email, verifier: 'v', nonce: 'n' }] : [] }))
    const gateway = {
      exchange: vi.fn().mockResolvedValue({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: `openid email ${DRIVE_FILE_SCOPE}`, id_token: 't' }),
      verify: vi.fn().mockResolvedValue({ email: 'someone.else@amnex.com', sub: 's' }), profile: vi.fn(),
    }
    const headers: Record<string, string> = {}
    const reply: any = { header: (k: string, v: string) => { headers[k] = v; return reply }, code: () => reply, send: () => reply }
    await completeDriveConnection({ query: { state, code: 'c' }, headers: { cookie: '' } }, reply, gateway)
    expect(headers.Location).toContain('drive_connection=wrong_account_or_permission')
    expect(sqlWith('INSERT INTO maker_drive_connections')).toHaveLength(0)
  })
})

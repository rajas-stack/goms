import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ state: null as any, query: vi.fn(), fetch: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: mock.query } }))
vi.mock('../lib/rbacTreeStore.js', () => ({ inTransaction: (fn: any) => fn({ query: mock.query }) }))
import { sealEmailCredentials } from '../email/config.js'
import { clearProfileByteCache, PROFILE_CREDENTIAL_BINDING, profilePhoto, profileStatus, syncProfileImages, updateProfileIndex, type ProfileState } from './service.js'
import { mapProfileImages, type ProfileFile } from './mapping.js'

const people = [{ id: 'u-1', name: 'User One', email: 'one@amnex.com', code: 'C1' }, { id: 'u-2', name: 'User Two', email: 'two@amnex.com' }]
const image = (id = 'photo-1', name = 'User One.jpg', version = '1'): ProfileFile => ({ id, name, version, mimeType: 'image/jpeg', parents: ['folder-a'] })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const state = (files: ProfileFile[] = []): ProfileState => ({ folderId: 'folder-a', folderName: 'Team', accountEmail: 'admin@amnex.com',
  credentials: sealEmailCredentials({ accessToken: 'server-only-access', refreshToken: 'server-only-refresh', expiresAt: Date.now() + 3600_000 }, PROFILE_CREDENTIAL_BINDING),
  files, mappings: mapProfileImages('folder-a', files, people).mappings, revision: 'old', error: null, warnings: [], lastSyncAt: null })
beforeEach(() => {
  vi.stubEnv('EMAIL_GOOGLE_CLIENT_ID', 'test.apps.googleusercontent.com'); vi.stubEnv('EMAIL_GOOGLE_CLIENT_SECRET', 'server-secret')
  vi.stubEnv('EMAIL_TOKEN_ENCRYPTION_KEY', 'x'.repeat(40)); vi.stubEnv('EMAIL_GOOGLE_REDIRECT_URI', 'http://localhost/api/oauth/google/callback')
  mock.query.mockReset(); mock.fetch.mockReset(); mock.state = state(); clearProfileByteCache(); vi.stubGlobal('fetch', mock.fetch)
  mock.query.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.startsWith('SELECT settings')) return { rows: [{ settings: structuredClone(mock.state) }] }
    if (sql.startsWith('INSERT INTO google_integration_settings')) mock.state = JSON.parse(params[2])
    if (sql.startsWith('SELECT id,name,email')) return { rows: people }
    return { rows: [] }
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('incremental profile synchronization', () => {
  it('indexes paginated files once for every user, and persists only metadata and encrypted credentials', async () => {
    mock.fetch.mockImplementation(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/files/folder-a')) return json({ id: 'folder-a', name: 'Team', mimeType: 'application/vnd.google-apps.folder' })
      if (url.pathname.endsWith('/changes/startPageToken')) return json({ startPageToken: 'cursor-1' })
      return url.searchParams.has('pageToken') ? json({ files: [image('photo-2', 'User Two.jpg')] }) : json({ files: [image()], nextPageToken: 'page-2' })
    })
    const result = await syncProfileImages()
    expect(result).toMatchObject({ status: 'connected', imageCount: 2, matchedCount: 2 })
    expect(mock.state.pageToken).toBe('cursor-1'); expect(mock.fetch).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(mock.state)).not.toContain('server-only-'); expect(JSON.stringify(result)).not.toMatch(/credentials|accessToken|refreshToken/)
    expect(mock.fetch.mock.calls.every(([url]) => !String(url).includes('u-1'))).toBe(true)
    const personSql = mock.query.mock.calls.find(([sql]) => String(sql).startsWith('SELECT id,name,email'))![0]
    for (const table of ['employees', 'org_people', 'sales_persons', 'delivery_team_members']) expect(personSql).toContain(`FROM ${table}`)
  })
  it('applies additions, replacements, deletions, moves and trash over multiple change pages', async () => {
    const original = [image(), image('removed', 'old.jpg'), image('moved', 'moved.jpg'), image('trashed', 'trashed.jpg')]
    const current = { ...state(original), pageToken: 'cursor-1' }
    const before = current.mappings['u-1'].version
    mock.fetch.mockResolvedValueOnce(json({ id: 'folder-a', name: 'Team', mimeType: 'application/vnd.google-apps.folder' }))
      .mockResolvedValueOnce(json({ changes: [{ fileId: 'photo-1', file: image('photo-1', 'User One.jpg', '2') }, { fileId: 'removed', removed: true }], nextPageToken: 'page-2' }))
      .mockResolvedValueOnce(json({ changes: [{ fileId: 'photo-2', file: image('photo-2', 'User Two.jpg') }, { fileId: 'moved', file: { ...image('moved'), parents: ['other'] } }, { fileId: 'trashed', file: { ...image('trashed'), trashed: true } }], newStartPageToken: 'cursor-2' }))
    await updateProfileIndex(current, 'token', people)
    expect(current.files.map(file => file.id)).toEqual(['photo-1', 'photo-2'])
    expect(current.pageToken).toBe('cursor-2'); expect(current.mappings['u-1'].version).not.toBe(before)
    expect(mock.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/files'))).toHaveLength(0)
  })
  it('keeps the prior complete cursor/index after a partial page fails and exposes a safe error', async () => {
    mock.state = { ...state([image()]), pageToken: 'cursor-1' }
    mock.fetch.mockResolvedValueOnce(json({ id: 'folder-a', name: 'Team', mimeType: 'application/vnd.google-apps.folder' }))
      .mockResolvedValueOnce(json({ changes: [{ fileId: 'photo-1', removed: true }], nextPageToken: 'page-2' }))
      .mockResolvedValueOnce(json({ error: 'private provider diagnostic' }, 500))
    const result = await syncProfileImages()
    expect(result.status).toBe('error'); expect(result.error).not.toContain('private provider')
    expect(mock.state.pageToken).toBe('cursor-1'); expect(mock.state.files).toHaveLength(1)
  })
  it('clears the old folder mapping on a failed switch, and fully indexes the new folder on retry', async () => {
    mock.state = { ...state([image()]), pageToken: 'old-cursor' }
    mock.fetch.mockResolvedValueOnce(json({}, 403))
    expect(await syncProfileImages('folder-b')).toMatchObject({ folderId: 'folder-b', status: 'error', imageCount: 0 })
    expect(mock.state.mappings).toEqual({}); expect(mock.state.pageToken).toBeUndefined()
    mock.fetch.mockResolvedValueOnce(json({ id: 'folder-b', name: 'New team', mimeType: 'application/vnd.google-apps.folder' }))
      .mockResolvedValueOnce(json({ startPageToken: 'new-cursor' })).mockResolvedValueOnce(json({ files: [{ ...image('new-photo'), parents: ['folder-b'] }] }))
    expect(await syncProfileImages()).toMatchObject({ status: 'connected', matchedCount: 1 })
    expect(mock.state.mappings['u-1'].fileId).toBe('new-photo')
  })
  it.each([401, 403, 404])('invalidates mappings on authorization/folder failures (%s)', async code => {
    mock.state = { ...state([image()]), pageToken: 'cursor-1' }; mock.fetch.mockResolvedValueOnce(json({}, code))
    const result = await syncProfileImages()
    expect(result.status).toBe('error'); expect(mock.state.mappings).toEqual({}); expect(mock.state.pageToken).toBeUndefined()
  })
  it('disables the folder without Drive requests', async () => {
    mock.state = state([image()]); expect(await syncProfileImages('')).toMatchObject({ folderId: '', imageCount: 0 })
    expect(mock.state.mappings).toEqual({}); expect(mock.fetch).not.toHaveBeenCalled()
  })
  it('refreshes expired authorization only on the server', async () => {
    mock.state.credentials = sealEmailCredentials({ accessToken: 'expired', refreshToken: 'server-only-refresh', expiresAt: 0 }, PROFILE_CREDENTIAL_BINDING)
    mock.fetch.mockResolvedValueOnce(json({ access_token: 'renewed-server-token', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ id: 'folder-a', name: 'Team', mimeType: 'application/vnd.google-apps.folder' }))
      .mockResolvedValueOnce(json({ startPageToken: 'c' })).mockResolvedValueOnce(json({ files: [] }))
    const result = await syncProfileImages()
    expect(result.status).toBe('connected'); expect(mock.fetch.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
    expect(JSON.stringify(mock.state)).not.toContain('renewed-server-token')
  })
  it('uses a shared drive-specific cursor and listing, and preserves revisions on unchanged syncs', async () => {
    const current = state([image()]); current.driveId = 'shared-drive'; current.pageToken = 'shared-cursor'
    mock.fetch.mockResolvedValueOnce(json({ id: 'folder-a', name: 'Team', mimeType: 'application/vnd.google-apps.folder', driveId: 'shared-drive' }))
      .mockResolvedValueOnce(json({ changes: [], newStartPageToken: 'next' }))
    await updateProfileIndex(current, 'token', people)
    expect(current.revision).toBe('old'); expect(new URL(mock.fetch.mock.calls[1][0]).searchParams.get('driveId')).toBe('shared-drive')
  })
})
describe('private thumbnail delivery', () => {
  it('coalesces simultaneous requests, prefers 96px thumbnails, and caches bytes without another Drive call', async () => {
    const current = state([image()]); mock.state = current
    mock.fetch.mockResolvedValueOnce(json({ thumbnailLink: 'https://lh3.googleusercontent.com/private=s220', parents: ['folder-a'] }))
      .mockResolvedValueOnce(new Response('jpeg-bytes', { headers: { 'Content-Type': 'image/jpeg' } }))
    const mapping = current.mappings['u-1']
    const photos = await Promise.all([profilePhoto(current, mapping), profilePhoto(current, mapping)])
    expect(photos[0].body.toString()).toBe('jpeg-bytes'); expect(photos[0]).toBe(photos[1])
    expect(mock.fetch.mock.calls[1][0].toString()).toBe('https://lh3.googleusercontent.com/private=s96')
    await profilePhoto(current, mapping); expect(mock.fetch).toHaveBeenCalledTimes(2)
    expect(mock.query).not.toHaveBeenCalled()
    clearProfileByteCache()
    mock.fetch.mockResolvedValueOnce(json({ parents: ['other'] }))
    await expect(profilePhoto(current, mapping)).rejects.toMatchObject({ status: 404 })
  })
  it('never sends credentials to an arbitrary thumbnail host and falls back to the fixed Drive media endpoint', async () => {
    const current = state([image()]); mock.state = current
    mock.fetch.mockResolvedValueOnce(json({ thumbnailLink: 'https://attacker.example/private', parents: ['folder-a'] }))
      .mockResolvedValueOnce(new Response('webp', { headers: { 'Content-Type': 'image/webp' } }))
    expect((await profilePhoto(current, current.mappings['u-1'])).mime).toBe('image/webp')
    expect(mock.fetch.mock.calls.every(([url]) => !url.toString().includes('attacker'))).toBe(true)
  })
  it('rejects HTML/SVG responses and does not cache failures', async () => {
    const current = state([image()]); mock.state = current
    mock.fetch.mockResolvedValueOnce(json({ parents: ['folder-a'] })).mockResolvedValueOnce(new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }))
    await expect(profilePhoto(current, current.mappings['u-1'])).rejects.toMatchObject({ status: 415 })
    expect(profileStatus(current)).not.toHaveProperty('credentials')
  })
})

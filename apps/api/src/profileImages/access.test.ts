import Fastify from 'fastify'
import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ query: vi.fn(), verify: vi.fn(), facts: vi.fn(), tree: vi.fn(), photo: vi.fn(), token: vi.fn(), drive: vi.fn(), state: null as any }))
vi.mock('../db.js', () => ({ pool: { query: mock.query } }))
vi.mock('../auth/identity.js', () => ({ verifyIdentity: mock.verify, isAmnexAccount: (email: string) => email.endsWith('@amnex.com'), isAllowListed: (email: string, allowed: string) => (allowed ?? '').split(',').includes(email) }))
vi.mock('../auth/rbac/userFacts.js', () => ({ loadUserFacts: mock.facts }))
vi.mock('../lib/rbacTreeStore.js', () => ({ resolveForEmail: mock.tree, inTransaction: (fn: any) => fn({ query: mock.query }) }))
vi.mock('./service.js', async original => ({ ...await original<typeof import('./service.js')>(), profilePhoto: mock.photo, profileToken: mock.token, driveJson: mock.drive }))
import { assertProfileMappingAccess, profileActor } from './access.js'
import { profileImagesRouter } from '../routers/profileImages.js'
import { registerProfileImageRoutes } from '../routes/profileImageRoutes.js'

beforeEach(() => {
  vi.stubEnv('AUTH_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('READ_AUTH_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('RBAC_MODE', 'off')
  vi.stubEnv('SECURITY_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('ADMIN_ALLOWED_EMAILS', 'admin@amnex.com')
  mock.verify.mockReset().mockResolvedValue({ uid: 'admin', email: 'admin@amnex.com' })
  mock.facts.mockReset().mockResolvedValue({ email: 'admin@amnex.com', roles: ['system_admin'], salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } })
  mock.tree.mockReset().mockResolvedValue({ configured: false, allowed: {} })
  mock.photo.mockReset().mockResolvedValue({ body: Buffer.from('private-photo'), mime: 'image/jpeg' })
  mock.token.mockReset().mockResolvedValue('server-drive-token')
  mock.drive.mockReset().mockResolvedValue({ files: [{ id: 'folder-team', name: 'Team' }] })
  mock.state = { folderId: 'folder-a', folderName: 'Team', accountEmail: 'admin@amnex.com', credentials: { data: 'encrypted' }, revision: 'revision-1',
    files: [], mappings: { 'u-1': { fileId: 'private-drive-id', version: 'version-1' } }, warnings: [], error: null, lastSyncAt: null }
  mock.query.mockReset().mockImplementation(async (sql: string, params: string[]) => sql.startsWith('SELECT settings') ? { rows: [{ settings: { ...structuredClone(mock.state), ...(params[1] ? { mapping: mock.state.mappings[params[1]] } : {}) } }] } : { rows: [] })
})
afterEach(() => vi.unstubAllEnvs())
describe('private profile access', () => {
  it('requires identity even when staged authentication and RBAC are disabled', async () => {
    mock.verify.mockRejectedValue(new TRPCError({ code: 'UNAUTHORIZED' }))
    await expect(profileImagesRouter.createCaller({}).index()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mock.query).not.toHaveBeenCalled()
  })
  it('requires an allow-listed administrator and DMS edit permission for configuration', async () => {
    mock.verify.mockResolvedValue({ uid: 'staff', email: 'staff@amnex.com' })
    await expect(profileImagesRouter.createCaller({}).save({ folder: 'folder-b' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    mock.verify.mockResolvedValue({ uid: 'admin', email: 'admin@amnex.com' })
    mock.tree.mockResolvedValue({ configured: true, allowed: { 'settings.system.storage': 1 } })
    await expect(profileImagesRouter.createCaller({}).sync()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mock.query).not.toHaveBeenCalled()
  })
  it('requires both the People policy and directory visibility to access photos', async () => {
    mock.facts.mockResolvedValue({ email: 'staff@amnex.com', roles: [], salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } })
    await expect(profileActor({})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    mock.facts.mockResolvedValue({ email: 'admin@amnex.com', roles: ['system_admin'], salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } })
    mock.tree.mockResolvedValue({ configured: true, allowed: { 'accountMapping.directory': 0 } })
    await expect(assertProfileMappingAccess({ email: 'admin@amnex.com' }, { fileId: 'photo', version: '1', scope: 'contacts' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('returns a single cached version index, with no credentials, file IDs or Drive calls', async () => {
    expect(await profileImagesRouter.createCaller({}).index()).toEqual({ configured: true, revision: 'revision-1', versions: { 'u-1': 'version-1' }, names: {} })
    mock.state.error = 'Drive unavailable'
    expect((await profileImagesRouter.createCaller({}).index()).versions).toEqual({})
    expect(mock.photo).not.toHaveBeenCalled()
  })
  it('lets a non-admin People viewer refresh photos, throttled and without exposing credentials', async () => {
    mock.verify.mockResolvedValue({ uid: 'staff', email: 'staff@amnex.com' })
    mock.state.lastAttemptAt = new Date().toISOString()
    const result = await profileImagesRouter.createCaller({}).refresh()
    expect(result).toMatchObject({ configured: true, folderName: 'Team', imageCount: 0, error: null })
    expect(JSON.stringify(result)).not.toContain('encrypted')
    expect(mock.token).not.toHaveBeenCalled() // a sync within 10 seconds is not repeated against Drive
  })
  it('continues to honor the application read-only switch', async () => {
    vi.stubEnv('EMERGENCY_READ_ONLY', 'true')
    await expect(profileImagesRouter.createCaller({}).save({ folder: 'folder-b' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mock.query).not.toHaveBeenCalled()
  })
  it('filters employee, Sales and contact versions by their own module permissions', async () => {
    mock.state.mappings = { contact: { fileId: 'a', version: 'c', scope: 'contacts' }, org: { fileId: 'b', version: 'o', scope: 'internal' }, sales: { fileId: 'd', version: 's', scope: 'sales' } }
    mock.tree.mockResolvedValue({ configured: true, allowed: { 'accountMapping.directory': 0, 'teams': 1, 'teams.sales': 0 } })
    expect((await profileImagesRouter.createCaller({}).index()).versions).toEqual({ org: 'o' })
    mock.tree.mockResolvedValue({ configured: true, allowed: { 'accountMapping.directory': 0, 'teams': 0, 'teams.sales': 1 } })
    expect((await profileImagesRouter.createCaller({}).index()).versions).toEqual({ sales: 's' })
  })
})
describe('My Drive folder browsing', () => {
  it('starts with direct folders in My Drive instead of a global folder search', async () => {
    const result = await profileImagesRouter.createCaller({}).folders({})
    expect(result.files).toEqual([{ id: 'folder-team', name: 'Team' }])
    expect(mock.drive).toHaveBeenCalledWith('server-drive-token', 'files', expect.objectContaining({
      q: "'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", spaces: 'drive',
    }))
  })
  it('lists only direct children of the opened folder and keeps pagination scoped to that parent', async () => {
    await profileImagesRouter.createCaller({}).folders({ parentId: 'folder-team', pageToken: 'next-page' })
    expect(mock.drive).toHaveBeenCalledWith('server-drive-token', 'files', expect.objectContaining({
      q: "'folder-team' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", pageToken: 'next-page',
    }))
  })
  it('rejects malformed parent IDs before contacting Drive', async () => {
    await expect(profileImagesRouter.createCaller({}).folders({ parentId: "folder' or trashed=true" })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mock.drive).not.toHaveBeenCalled()
  })
  it('keeps folder browsing behind the DMS administrator permission boundary', async () => {
    mock.verify.mockResolvedValue({ uid: 'staff', email: 'staff@amnex.com' })
    await expect(profileImagesRouter.createCaller({}).folders({})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mock.drive).not.toHaveBeenCalled()
  })
})
describe('HTTP image caching and authorization', () => {
  async function request(url = '/api/profile-images/u-1?v=version-1', headers: Record<string, string> = {}) {
    const app = Fastify(); registerProfileImageRoutes(app)
    try { return await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer current-account', ...headers } }) }
    finally { await app.close() }
  }
  it('serves authenticated private bytes with a version ETag', async () => {
    const response = await request()
    expect(response.statusCode).toBe(200); expect(response.body).toBe('private-photo')
    expect(response.headers['cache-control']).toBe('private, no-cache'); expect(response.headers.vary).toBe('Authorization')
    expect(response.headers.etag).toBe('"version-1"'); expect(response.headers['content-type']).toContain('image/jpeg')
  })
  it('reauthorizes before returning 304 and makes no Drive delivery call', async () => {
    expect((await request(undefined, { 'if-none-match': '"version-1"' })).statusCode).toBe(304)
    expect(mock.photo).not.toHaveBeenCalled(); expect(mock.verify).toHaveBeenCalled()
    mock.verify.mockRejectedValue(new TRPCError({ code: 'UNAUTHORIZED' }))
    const denied = await request(undefined, { 'if-none-match': '"version-1"' })
    expect(denied.statusCode).toBe(401); expect(denied.headers['cache-control']).toContain('no-store')
  })
  it('rejects stale folder versions, unknown users and permission failures', async () => {
    expect((await request('/api/profile-images/u-1?v=old-folder-version')).statusCode).toBe(404)
    expect((await request('/api/profile-images/unknown?v=version-1')).statusCode).toBe(404)
    mock.tree.mockResolvedValue({ configured: true, allowed: { 'accountMapping.directory': 0 } })
    expect((await request()).statusCode).toBe(403); expect(mock.photo).not.toHaveBeenCalled()
  })
  it('discards an in-flight image when the folder changes before delivery', async () => {
    mock.photo.mockImplementation(async () => { mock.state.mappings = {}; return { body: Buffer.from('old-photo'), mime: 'image/jpeg' } })
    const response = await request(); expect(response.statusCode).toBe(404); expect(response.body).not.toContain('old-photo')
  })
  it('denies direct Sales photo delivery and conditional responses to an employee-only reader', async () => {
    mock.state.mappings['u-1'].scope = 'sales'
    mock.tree.mockResolvedValue({ configured: true, allowed: { 'teams': 1, 'teams.sales': 0 } })
    expect((await request(undefined, { 'if-none-match': '"version-1"' })).statusCode).toBe(403)
    expect(mock.photo).not.toHaveBeenCalled()
  })
})

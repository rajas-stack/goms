import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ query: vi.fn(), verify: vi.fn(), facts: vi.fn(), tree: vi.fn(), photo: vi.fn(), state: null as any }))
vi.mock('../db.js', () => ({ pool: { query: mock.query } }))
vi.mock('../auth/identity.js', () => ({ verifyIdentity: mock.verify, isAmnexAccount: (email: string) => email.endsWith('@amnex.com'), isAllowListed: (email: string, allowed: string) => (allowed ?? '').split(',').includes(email) }))
vi.mock('../auth/rbac/userFacts.js', () => ({ loadUserFacts: mock.facts }))
vi.mock('../lib/rbacTreeStore.js', () => ({ resolveForEmail: mock.tree, inTransaction: (fn: any) => fn({ query: mock.query }) }))
vi.mock('./service.js', async original => ({ ...await original<typeof import('./service.js')>(), profilePhoto: mock.photo }))
import { profileActor } from './access.js'
import { profileImagesRouter } from '../routers/profileImages.js'

beforeEach(() => {
  vi.stubEnv('AUTH_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('READ_AUTH_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('RBAC_MODE', 'off')
  vi.stubEnv('SECURITY_ENFORCEMENT_ENABLED', 'false'); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('ADMIN_ALLOWED_EMAILS', 'admin@amnex.com')
  mock.verify.mockReset().mockResolvedValue({ uid: 'admin', email: 'admin@amnex.com' })
  mock.facts.mockReset().mockResolvedValue({ email: 'admin@amnex.com', roles: ['system_admin'], salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } })
  mock.tree.mockReset().mockResolvedValue({ configured: false, allowed: {} })
  mock.photo.mockReset().mockResolvedValue({ body: Buffer.from('private-photo'), mime: 'image/jpeg' })
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
    await expect(profileActor({})).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('returns a single cached version index, with no credentials, file IDs or Drive calls', async () => {
    expect(await profileImagesRouter.createCaller({}).index()).toEqual({ configured: true, revision: 'revision-1', versions: { 'u-1': 'version-1' } })
    mock.state.error = 'Drive unavailable'
    expect((await profileImagesRouter.createCaller({}).index()).versions).toEqual({})
    expect(mock.photo).not.toHaveBeenCalled()
  })
  it('continues to honor the application read-only switch', async () => {
    vi.stubEnv('EMERGENCY_READ_ONLY', 'true')
    await expect(profileImagesRouter.createCaller({}).save({ folder: 'folder-b' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mock.query).not.toHaveBeenCalled()
  })
})

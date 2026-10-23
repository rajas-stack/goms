import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ query: vi.fn(), locked: vi.fn(), sync: vi.fn(), access: vi.fn(), write: vi.fn(), clear: vi.fn(), flow: null as any, saved: null as any }))
vi.mock('../db.js', () => ({ pool: { query: mock.query } }))
vi.mock('./access.js', () => ({ assertProfileAccess: mock.access }))
vi.mock('../auth/rbac/systemAdminOnly.js', () => ({ isSystemAdminEmail: (email: string) => email === 'admin@amnex.com' }))
vi.mock('./service.js', () => ({ PROFILE_CREDENTIAL_BINDING: 'goms:profile-images:v1', clearProfileByteCache: mock.clear,
  withProfileLock: mock.locked, writeProfileState: mock.write, syncProfileImages: mock.sync }))
import { beginProfileConnection, completeProfileConnection, PROFILE_DRIVE_SCOPE } from './oauth.js'
import { openEmailCredentials } from '../email/config.js'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
beforeEach(() => {
  vi.clearAllMocks(); mock.flow = null; mock.saved = null
  vi.stubEnv('EMAIL_GOOGLE_CLIENT_ID', 'profile.apps.googleusercontent.com'); vi.stubEnv('EMAIL_GOOGLE_CLIENT_SECRET', 'secret')
  vi.stubEnv('EMAIL_CENTER_ENABLED', 'true'); vi.stubEnv('EMAIL_TOKEN_ENCRYPTION_KEY', 'x'.repeat(40)); vi.stubEnv('EMAIL_GOOGLE_REDIRECT_URI', 'https://goms.test/api/oauth/google/callback')
  mock.access.mockResolvedValue(undefined); mock.sync.mockResolvedValue({}); mock.locked.mockImplementation((fn: any) => fn({ mappings: {}, files: [] }, {}))
  mock.write.mockImplementation(async (_db: any, state: any) => { mock.saved = state })
  mock.query.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.startsWith('INSERT INTO email_oauth_flows')) mock.flow = { state_hash: params[0], cookie_hash: params[1], verifier: params[2], nonce: params[3], user_uid: params[4], email: params[5] }
    if (sql.startsWith('DELETE FROM email_oauth_flows WHERE state_hash=')) {
      if (mock.flow?.state_hash === params[0] && mock.flow?.cookie_hash === params[1]) { const flow = mock.flow; mock.flow = null; return { rows: [flow] } }
    }
    return { rows: [] }
  })
})
afterEach(() => vi.unstubAllEnvs())
const gateway = () => ({ exchange: vi.fn().mockResolvedValue({ access_token: 'private-drive-access', refresh_token: 'private-drive-refresh', expires_in: 3600, scope: `openid email ${PROFILE_DRIVE_SCOPE}`, id_token: 'private-id-token' }),
  verify: vi.fn().mockResolvedValue({ email: 'admin@amnex.com', sub: 'google-admin' }), profile: vi.fn() })
const reply = () => {
  const result = { code: vi.fn(), header: vi.fn(), send: vi.fn() }
  result.code.mockReturnValue(result); result.header.mockReturnValue(result); result.send.mockReturnValue(result)
  return result
}
async function begin() {
  let cookie = ''; const result = await beginProfileConnection({ uid: 'admin', email: 'admin@amnex.com' }, value => { cookie = value })
  return { url: new URL(result.url), cookie: cookie.split(';')[0], result }
}
describe('server-only Drive authorization', () => {
  it('uses offline read-only Drive consent, PKCE and a separate HttpOnly browser binding', async () => {
    const connection = await begin(); const params = connection.url.searchParams
    expect(params.get('scope')).toBe(`openid email ${PROFILE_DRIVE_SCOPE}`); expect(params.get('access_type')).toBe('offline')
    expect(params.get('code_challenge_method')).toBe('S256'); expect(params.get('state')).toMatch(/^profile\./)
    expect(mock.flow.state_hash).toBe(hash(params.get('state')!)); expect(JSON.stringify(connection.result)).not.toMatch(/private-drive|refresh_token|access_token/)
  })
  it('exchanges the code on the server, verifies nonce/identity, seals credentials and refreshes the index', async () => {
    const connection = await begin(); const original = { ...mock.flow }; const google = gateway(); const response = reply()
    await completeProfileConnection({ query: { state: connection.url.searchParams.get('state'), code: 'one-time-code' }, headers: { cookie: connection.cookie } }, response as any, google)
    expect(google.exchange).toHaveBeenCalledWith('one-time-code', original.verifier)
    expect(google.verify).toHaveBeenCalledWith('private-id-token', original.nonce)
    expect(mock.access).toHaveBeenCalledWith({ email: 'admin@amnex.com', sub: 'google-admin' }, true, true)
    expect(JSON.stringify(mock.saved)).not.toContain('private-drive')
    expect(openEmailCredentials(mock.saved.credentials, 'goms:profile-images:v1').refreshToken).toBe('private-drive-refresh')
    expect(mock.sync).toHaveBeenCalled(); expect(response.header).toHaveBeenCalledWith('Location', 'https://goms.test/settings/dms?profile_connection=connected')
    expect(google.profile).not.toHaveBeenCalled() // This flow does not require Gmail permission.
  })
  it('rejects cross-browser callbacks and replay without consuming the legitimate flow', async () => {
    const connection = await begin(); const google = gateway(); const state = connection.url.searchParams.get('state')
    const wrong = reply(); await completeProfileConnection({ query: { state, code: 'code' }, headers: {} }, wrong as any, google)
    expect(wrong.code).toHaveBeenCalledWith(400); expect(mock.flow).not.toBeNull(); expect(google.exchange).not.toHaveBeenCalled()
    await completeProfileConnection({ query: { state, code: 'code' }, headers: { cookie: connection.cookie } }, reply() as any, google)
    const replay = reply(); await completeProfileConnection({ query: { state, code: 'code' }, headers: { cookie: connection.cookie } }, replay as any, google)
    expect(replay.code).toHaveBeenCalledWith(400); expect(google.exchange).toHaveBeenCalledTimes(1)
  })
  it.each(['wrong-account', 'missing-scope', 'revoked-dms-edit'])('rejects %s without writing credentials', async reason => {
    const connection = await begin(); const google = gateway(); const response = reply()
    if (reason === 'wrong-account') google.verify.mockResolvedValue({ email: 'other@amnex.com', sub: 'other' })
    if (reason === 'missing-scope') google.exchange.mockResolvedValue({ access_token: 'private-drive-access', refresh_token: 'private-drive-refresh', expires_in: 3600, scope: 'openid email', id_token: 'private-id-token' })
    if (reason === 'revoked-dms-edit') mock.access.mockRejectedValue(new Error('permission revoked'))
    await completeProfileConnection({ query: { state: connection.url.searchParams.get('state'), code: 'code' }, headers: { cookie: connection.cookie } }, response as any, google)
    expect(mock.write).not.toHaveBeenCalled(); expect(mock.sync).not.toHaveBeenCalled()
    expect(response.header.mock.calls.some(([key, value]) => key === 'Location' && !value.endsWith('=connected'))).toBe(true)
  })
})

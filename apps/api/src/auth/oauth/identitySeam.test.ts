import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeIdToken } from '../../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { signAccessToken } from './accessToken.js'
import { verifyAdminImportToken } from '../verifyAdminImportToken.js'
import { verifyIdentity } from '../identity.js'

afterEach(() => { clearOauthEnv(); delete process.env.ADMIN_IMPORT_ALLOWED_EMAILS })
const firebase = (email = 'someone@amnex.com') => `Bearer ${fakeIdToken({ uid: 'fb-1', email })}`
const goms = async (email = 'someone@amnex.com') => (await gomsContextForEmail(email, 'g:1')).authHeader

describe.each([
  ['firebase', true, false], ['both', true, true], ['oauth', false, true],
] as const)('verifyIdentity with AUTH_PROVIDER=%s', (provider, acceptsFirebase, acceptsGoms) => {
  beforeEach(() => useOauthEnv(provider))

  it(`${acceptsFirebase ? 'accepts' : 'rejects'} a Firebase token`, async () => {
    const r = verifyIdentity(firebase())
    if (acceptsFirebase) await expect(r).resolves.toEqual({ uid: 'fb-1', email: 'someone@amnex.com' })
    else await expect(r).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it(`${acceptsGoms ? 'accepts' : 'rejects'} a GOMS token`, async () => {
    const r = verifyIdentity(await goms())
    if (acceptsGoms) await expect(r).resolves.toEqual({ uid: 'g:1', email: 'someone@amnex.com' })
    else await expect(r).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it('keeps today\'s errors for a missing header and for garbage', async () => {
    await expect(verifyIdentity(undefined)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
    await expect(verifyIdentity('Bearer not-a-real-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(verifyIdentity('Basic abc')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('GOMS tokens in `both` never fall through to Firebase', () => {
  beforeEach(() => useOauthEnv('both'))
  it('an expired GOMS token is "session expired", not a second chance as a Firebase token', async () => {
    const { token } = await signAccessToken({ uid: 'g:1', email: 'a@amnex.com', familyId: '33333333-3333-3333-3333-333333333333' }, new Date(Date.now() - 3600_000))
    await expect(verifyIdentity(`Bearer ${token}`)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
  })
  it('a token claiming iss=goms but signed with another key is refused', async () => {
    process.env.AUTH_SESSION_SECRET = 'q'.repeat(40) // sign with one secret ...
    const { token } = await signAccessToken({ uid: 'g:1', email: 'a@amnex.com', familyId: '33333333-3333-3333-3333-333333333333' })
    useOauthEnv('both')                                  // ... verify with another
    await expect(verifyIdentity(`Bearer ${token}`)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('a missing or short AUTH_SESSION_SECRET (server misconfiguration) while a GOMS token arrives', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => { useOauthEnv('both'); errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => errorSpy.mockRestore())

  it.each([['missing', undefined], ['too short', 'too-short-secret']] as const)('%s: the same generic UNAUTHORIZED as any bad token, and one value-free config_error log line', async (_label, secret) => {
    const header = await goms()
    if (secret === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = secret
    await expect(verifyIdentity(header)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = String(errorSpy.mock.calls[0][0])
    expect(JSON.parse(line)).toEqual({ event: 'auth.config_error' })
    expect(line).not.toMatch(/AUTH_SESSION_SECRET|too-short-secret|Bearer|eyJ/)
  })
  it('does not affect Firebase tokens in `both`, which verify exactly as before and log nothing', async () => {
    delete process.env.AUTH_SESSION_SECRET
    await expect(verifyIdentity(firebase())).resolves.toEqual({ uid: 'fb-1', email: 'someone@amnex.com' })
    expect(errorSpy).not.toHaveBeenCalled()
  })
  it('an ordinarily bad GOMS token (wrong key, expired) is NOT logged as a configuration problem', async () => {
    const { token } = await signAccessToken({ uid: 'g:1', email: 'a@amnex.com', familyId: '33333333-3333-3333-3333-333333333333' }, new Date(Date.now() - 3600_000))
    await expect(verifyIdentity(`Bearer ${token}`)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('Admin Data Import allow-list works identically for both token kinds', () => {
  beforeEach(() => { useOauthEnv('both'); process.env.ADMIN_IMPORT_ALLOWED_EMAILS = 'admin@amnex.com' })
  it('allow-listed -> ok; anyone else -> FORBIDDEN, for Firebase and GOMS tokens alike', async () => {
    await expect(verifyAdminImportToken(firebase('admin@amnex.com'))).resolves.toMatchObject({ email: 'admin@amnex.com' })
    await expect(verifyAdminImportToken(await goms('admin@amnex.com'))).resolves.toMatchObject({ email: 'admin@amnex.com' })
    await expect(verifyAdminImportToken(firebase('rando@amnex.com'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(verifyAdminImportToken(await goms('rando@amnex.com'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

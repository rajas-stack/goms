// apps/api/src/email/emailCenterGuard.test.ts
// Email Center and Profile Images (the Gmail and Drive connections) are OFF unless EMAIL_CENTER_ENABLED is exactly `true`, whatever else is configured.
// Every case below has the Google client, the callback, the dedicated key, the session secret and a system administrator all in place, so the ONLY thing that
// differs between "refused" and "works" is the flag. "Refused" means: an error or 404, nothing written to the database, no cookie set, no call to Google.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.js'
import { pool } from '../db.js'
import { syncRbacNodes } from '../lib/rbacTreeStore.js'
import { cleanupOauthTables, clearOauthEnv, gomsContextForEmail, TEST_EMAIL_KEY, useOauthEnv } from '../testHelpers/oauthTestHelpers.js'
import { emailCenterEnabled, emailConfiguration, openEmailCredentials, requireEmailConfiguration, sealEmailCredentials } from './config.js'
import { beginMailConnection, completeMailConnection } from './oauth.js'
import { beginProfileConnection, completeProfileConnection } from '../profileImages/oauth.js'
import { profilePhoto, profileToken, startProfileImageSynchronizer, syncProfileImages } from '../profileImages/service.js'
import { ensureBrowser } from '../auth/oauth/browserBinding.js'

const ADMIN = 'admin@amnex.com'
const OFF_VALUES: (string | undefined)[] = [undefined, '', '   ', 'false', 'FALSE', 'TRUE', 'True', '1', 'yes', 'on', 'enabled', 'true1', 'truee', 'ture']
let app: Awaited<ReturnType<typeof buildApp>>
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>
let fetchSpy: ReturnType<typeof vi.spyOn>

/** Everything configured except (possibly) the flag. */
function configure(flag: string | undefined) {
  useOauthEnv('both'); process.env.ADMIN_ALLOWED_EMAILS = ADMIN; process.env.EMAIL_TOKEN_ENCRYPTION_KEY = TEST_EMAIL_KEY
  if (flag === undefined) delete process.env.EMAIL_CENTER_ENABLED; else process.env.EMAIL_CENTER_ENABLED = flag
}
beforeAll(async () => { configure('true'); await syncRbacNodes(null); clearOauthEnv(); delete process.env.ADMIN_ALLOWED_EMAILS })
beforeEach(async () => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); error = vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchSpy = vi.spyOn(globalThis, 'fetch'); await cleanupOauthTables(); await pool.query('DELETE FROM email_oauth_flows')
})
afterEach(async () => { await app?.close(); clearOauthEnv(); delete process.env.ADMIN_ALLOWED_EMAILS; for (const s of [warn, error, fetchSpy]) s.mockRestore(); await pool.query('DELETE FROM email_oauth_flows'); await cleanupOauthTables() })
afterAll(() => pool.end?.().catch(() => {}))

async function boot() { app = await buildApp({ rateLimit: { max: 100_000, timeWindow: '1 minute' } }); return app }
const adminHeader = async () => (await gomsContextForEmail(ADMIN)).authHeader
const trpc = async (method: 'GET' | 'POST', proc: string, input?: unknown, cookie?: string) => {
  const headers: Record<string, string> = { authorization: await adminHeader(), origin: 'https://goms.test' }; if (cookie) headers.cookie = cookie
  const res = method === 'GET'
    ? await app.inject({ method, url: `/api/trpc/${proc}${input === undefined ? '' : '?input=' + encodeURIComponent(JSON.stringify(input))}`, headers })
    : await app.inject({ method, url: `/api/trpc/${proc}`, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(input ?? {}) })
  const body = JSON.parse(res.body)
  return { status: res.statusCode, code: body.error?.data?.code as string | undefined, data: body.result?.data, setCookie: res.headers['set-cookie'], body }
}
const count = async (table: string) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count)
/** Row counts of every table the Gmail and Drive connections can write. */
const writes = async () => ({ flows: await count('email_oauth_flows'), mailboxes: await count('email_mailboxes'), events: await count('email_events'), settings: await count('google_integration_settings') })
const callbackUrl = (state: string, query = 'error=access_denied') => `/api/oauth/google/callback?${query}&state=${encodeURIComponent(state)}`
const FAKE_MAIL_STATE = 'mail.' + 'a'.repeat(43), FAKE_PROFILE_STATE = 'profile.' + 'b'.repeat(43)

describe('the flag', () => {
  it.each([['true', true], [' true ', true], ['true\n', true]] as const)('%j enables it', (value, expected) => { expect(emailCenterEnabled({ EMAIL_CENTER_ENABLED: value })).toBe(expected) })
  it.each(OFF_VALUES)('%j leaves it off', (value) => { expect(emailCenterEnabled({ EMAIL_CENTER_ENABLED: value })).toBe(false) })
  it('is off when unset, whatever else is configured', () => {
    configure(undefined)
    expect(emailCenterEnabled()).toBe(false)
    expect(emailConfiguration()).toEqual({ enabled: false, clientId: '', clientSecret: '', encryptionSecret: '', redirectUri: '', origin: '', ready: false })
  })
  it('setting the sign-in variables alone (client, secret, callback, session secret) does not enable it', () => {
    useOauthEnv('both'); delete process.env.EMAIL_CENTER_ENABLED; delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    expect(emailConfiguration().ready).toBe(false); expect(emailCenterEnabled()).toBe(false)
  })
  it('enabled still needs the DEDICATED key: the sign-in session secret is never borrowed', () => {
    useOauthEnv('both'); process.env.EMAIL_CENTER_ENABLED = 'true'; delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY
    expect(emailConfiguration().ready).toBe(false); expect(emailConfiguration().encryptionSecret).toBe('')
    process.env.EMAIL_TOKEN_ENCRYPTION_KEY = 'short'
    expect(emailConfiguration().ready).toBe(false)
    process.env.EMAIL_TOKEN_ENCRYPTION_KEY = TEST_EMAIL_KEY
    expect(emailConfiguration().ready).toBe(true); expect(emailConfiguration().encryptionSecret).toBe(TEST_EMAIL_KEY)
  })
})

describe.each(OFF_VALUES)('flag %j: every raw API path is refused for a fully configured system administrator', (flag) => {
  beforeEach(async () => { configure(flag); await boot() })

  it('emailCenter.status reports not ready and no callback; emailCenter.connect is refused with nothing created', async () => {
    const before = await writes()
    const status = await trpc('GET', 'emailCenter.status')
    expect(status.status).toBe(200); expect(status.data.ready).toBe(false); expect(status.data.callback).toBeNull()
    const connect = await trpc('POST', 'emailCenter.connect', { returnTo: '/bid-tracker' })
    expect(connect.status).toBe(412); expect(connect.code).toBe('PRECONDITION_FAILED')
    expect(connect.setCookie).toBeUndefined(); expect(JSON.stringify(connect.body)).not.toContain('accounts.google.com')
    expect(await writes()).toEqual(before)
  })
  it('profileImages.connect, folders, test, save and sync are refused; nothing is written, no cookie is set, Google is never called', async () => {
    const before = await writes()
    const results = [
      await trpc('POST', 'profileImages.connect'),
      await trpc('GET', 'profileImages.folders', {}),
      await trpc('POST', 'profileImages.test', { folder: 'folder-id' }),
      await trpc('POST', 'profileImages.save', { folder: 'folder-id' }),
      await trpc('POST', 'profileImages.sync'),
    ]
    for (const r of results) { expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(412); expect(r.code).toBe('PRECONDITION_FAILED'); expect(r.setCookie).toBeUndefined() }
    expect(await writes()).toEqual(before)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('profileImages.status stays harmless: it reports oauthReady false', async () => {
    const status = await trpc('GET', 'profileImages.status')
    expect(status.status).toBe(200); expect(status.data.oauthReady).toBe(false); expect(status.data.status).toBe('disconnected')
  })
  it('the shared callback answers 404 for a "mail." or "profile." state, before any lookup, and consumes nothing', async () => {
    const before = await writes()
    for (const state of [FAKE_MAIL_STATE, FAKE_PROFILE_STATE]) {
      const r = await app.inject({ method: 'GET', url: callbackUrl(state, 'code=x') }); expect(r.statusCode, state).toBe(404)
      expect(String(r.headers.location ?? '')).toBe('')
    }
    expect(await writes()).toEqual(before); expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('a connection that was legitimately started while enabled cannot be completed once it is off, and its row is left untouched', async () => {
    process.env.EMAIL_CENTER_ENABLED = 'true'
    const started = await trpc('POST', 'emailCenter.connect', { returnTo: '/bid-tracker' })
    expect(started.status).toBe(200)
    const state = new URL(started.data.url).searchParams.get('state')!
    const cookie = String(([] as string[]).concat(started.setCookie as any)[0]).split(';')[0]
    expect(await count('email_oauth_flows')).toBe(1)
    if (flag === undefined) delete process.env.EMAIL_CENTER_ENABLED; else process.env.EMAIL_CENTER_ENABLED = flag
    const refused = await app.inject({ method: 'GET', url: callbackUrl(state), headers: { cookie } })
    expect(refused.statusCode).toBe(404)
    expect(await count('email_oauth_flows')).toBe(1) // not consumed
    process.env.EMAIL_CENTER_ENABLED = 'true'
    const allowed = await app.inject({ method: 'GET', url: callbackUrl(state), headers: { cookie } })
    expect(allowed.statusCode).toBe(302); expect(String(allowed.headers.location)).toContain('email_connection=cancelled') // and it is still valid once enabled
  })
  it('the sign-in redirect never asks for a Gmail or Drive scope, whatever the flag is', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web' })
    expect(r.statusCode).toBe(302)
    expect(new URL(String(r.headers.location)).searchParams.get('scope')).toBe('openid email profile')
  })
})

describe.each([undefined, 'false', 'TRUE', '1'])('flag %j: the code paths behind the API are refused too', (flag) => {
  beforeEach(() => { configure(flag) })
  it('begin and complete (Gmail and Drive) refuse; complete does not touch the database', async () => {
    const query = vi.spyOn(pool, 'query'); const setCookie = vi.fn()
    await expect(beginMailConnection({ uid: 'u', email: ADMIN }, '/x', setCookie)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    await expect(beginProfileConnection({ uid: 'u', email: ADMIN }, setCookie)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(setCookie).not.toHaveBeenCalled()
    const reply = () => { const r: any = { header: vi.fn(() => r), code: vi.fn(() => r), send: vi.fn(() => r) }; return r }
    for (const [fn, state] of [[completeMailConnection, FAKE_MAIL_STATE], [completeProfileConnection, FAKE_PROFILE_STATE]] as const) {
      const r = reply(); await (fn as any)({ query: { state, code: 'c' }, headers: {} }, r)
      expect(r.code).toHaveBeenCalledWith(404); expect(r.send).toHaveBeenCalledWith({ error: 'Not found' })
    }
    expect(query).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled(); query.mockRestore()
  })
  it('sync, token refresh and photo fetch refuse before any lock, read or Google call; sealing and opening credentials refuse', async () => {
    const query = vi.spyOn(pool, 'query')
    await expect(syncProfileImages()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    await expect(syncProfileImages('folder', true)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    await expect(profileToken({ credentials: undefined } as any)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    await expect(profilePhoto({ folderId: 'f', credentials: undefined }, { fileId: 'x', version: 'v' } as any)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(() => requireEmailConfiguration()).toThrow(/not enabled/)
    expect(() => sealEmailCredentials({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 }, 'binding')).toThrow()
    expect(() => openEmailCredentials({ version: 1, iv: '', tag: '', data: '' }, 'binding')).toThrow()
    expect(query).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled(); query.mockRestore()
  })
  it('the Profile Images synchronizer creates no timer and reads nothing', () => {
    const query = vi.spyOn(pool, 'query'); const timer = vi.spyOn(globalThis, 'setInterval')
    const stop = startProfileImageSynchronizer()
    expect(typeof stop).toBe('function'); stop()
    expect(timer).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); query.mockRestore(); timer.mockRestore()
  })
  it('with no session secret the browser-binding key is not borrowed from the (disabled) Email Center key', () => {
    delete process.env.AUTH_SESSION_SECRET
    expect(() => ensureBrowser(undefined, true)).toThrow()
  })
})

describe.each(['true', ' true '])('flag %j (explicitly enabled): the connections work, as before', (flag) => {
  beforeEach(async () => { configure(flag); await boot() })
  it('emailCenter.status is ready and shows the callback; the connect calls return a Google authorization URL with the connection state; the rows are created', async () => {
    const status = await trpc('GET', 'emailCenter.status')
    expect(status.data.ready).toBe(true); expect(status.data.callback).toBe('https://goms.test/api/oauth/google/callback')
    const mail = await trpc('POST', 'emailCenter.connect', { returnTo: '/bid-tracker' })
    expect(mail.status).toBe(200); expect(new URL(mail.data.url).searchParams.get('state')).toMatch(/^mail\./)
    const profile = await trpc('POST', 'profileImages.connect')
    expect(profile.status).toBe(200); expect(new URL(profile.data.url).searchParams.get('state')).toMatch(/^profile\./)
    expect(await count('email_oauth_flows')).toBe(2)
  })
  it('the sign-in redirect still asks only for openid, email and profile', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web' })
    expect(new URL(String(r.headers.location)).searchParams.get('scope')).toBe('openid email profile')
  })
})

describe('with sign-in off (AUTH_PROVIDER=firebase) the shared callback exists only when Email Center is enabled and fully configured', () => {
  it('disabled: no callback route at all', async () => {
    configure(undefined); process.env.AUTH_PROVIDER = 'firebase'; await boot()
    expect((await app.inject({ method: 'GET', url: callbackUrl(FAKE_MAIL_STATE, 'code=x') })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: callbackUrl(FAKE_PROFILE_STATE, 'code=x') })).statusCode).toBe(404)
  })
  it('enabled: the callback exists and refuses a state it did not issue', async () => {
    configure('true'); process.env.AUTH_PROVIDER = 'firebase'; await boot()
    expect((await app.inject({ method: 'GET', url: callbackUrl(FAKE_MAIL_STATE, 'code=x') })).statusCode).toBe(400)
  })
})

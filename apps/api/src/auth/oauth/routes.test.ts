// apps/api/src/auth/oauth/routes.test.ts
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../app.js'
import { pool } from '../../db.js'
import { cleanupOauthTables, clearOauthEnv, fakeGoogle, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { verifyAccessToken } from './accessToken.js'
import { pkceChallenge } from './crypto.js'
import { startSession } from './sessions.js'

let app: Awaited<ReturnType<typeof buildApp>>
let google: ReturnType<typeof fakeGoogle>
// The routes log on purpose (oauth.fail / oauth.misconfigured / oauth.error). Silenced for every test, restored after each, and asserted where the log matters.
let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
const ORIGIN = 'https://goms.test'

async function boot(over?: Parameters<typeof fakeGoogle>[0]) {
  google = fakeGoogle(over)
  app = await buildApp({ oauth: { google: google.gateway }, rateLimit: { max: 10_000, timeWindow: '1 minute' } })
}
beforeEach(async () => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useOauthEnv('both'); await cleanupOauthTables()
})
afterEach(async () => { await app?.close(); clearOauthEnv(); warnSpy.mockRestore(); errorSpy.mockRestore(); await cleanupOauthTables() })

const loc = (r: { headers: Record<string, unknown> }) => String(r.headers.location)
async function start(client: 'web' | 'app', returnTo = '/sales/roster') {
  const r = await app.inject({ method: 'GET', url: `/api/oauth/google/start?client=${client}&return_to=${encodeURIComponent(returnTo)}` })
  const u = new URL(loc(r))
  return { r, u, state: u.searchParams.get('state')!, nonce: u.searchParams.get('nonce')!, challenge: u.searchParams.get('code_challenge')! }
}
const callback = (state: string, code = 'google-code') =>
  app.inject({ method: 'GET', url: `/api/oauth/google/callback?code=${code}&state=${encodeURIComponent(state)}` })
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object })

describe('AUTH_PROVIDER=firebase (the default) is a true no-op: no OAuth route is registered', () => {
  const ROUTES = [['GET', '/api/oauth/google/start?client=web'], ['GET', '/api/oauth/google/callback?state=x&code=y'],
    ['POST', '/api/oauth/exchange'], ['POST', '/api/oauth/refresh'], ['POST', '/api/oauth/logout']] as const
  const modes: Array<[string, () => void]> = [
    ['unset', () => { delete process.env.AUTH_PROVIDER }],
    ["explicitly 'firebase'", () => { process.env.AUTH_PROVIDER = 'firebase' }],
  ]
  // Fastify's default 404 body echoes the request line ("Route GET:/x not found"); normalise only that echo so everything else is compared verbatim.
  const shape = (r: { statusCode: number; body: string; headers: Record<string, unknown> }, method: string, url: string) =>
    ({ s: r.statusCode, b: r.body.replace(`${method}:${url}`, '<route>'), ct: r.headers['content-type'] })

  describe.each(modes)('AUTH_PROVIDER %s', (_label, setMode) => {
    beforeEach(async () => { setMode(); await boot() })

    it('answers exactly like an unknown path (404 + the same body) on all five routes, and creates nothing', async () => {
      for (const [method, url] of ROUTES) {
        const unknown = await app.inject({ method, url: method === 'GET' ? '/api/oauth/does-not-exist' : '/api/nope', payload: method === 'POST' ? {} : undefined })
        expect(unknown.statusCode).toBe(404)
        const r = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined })
        expect(r.statusCode, url).toBe(404)
        expect(shape(r, method, url), url).toEqual(shape(unknown, method, method === 'GET' ? '/api/oauth/does-not-exist' : '/api/nope'))
        expect(r.body, url).not.toBe(JSON.stringify({ error: 'Not found' }))
      }
      expect((await pool.query('SELECT count(*)::int AS n FROM auth_flows')).rows[0].n).toBe(0)
    })

    it('adds no content-type handling of its own: unsupported type is a plain 404 (not 415) and malformed JSON answers as on any unknown path', async () => {
      for (const [, url] of ROUTES.filter(([m]) => m === 'POST')) {
        const unknown = await app.inject({ method: 'POST', url: '/api/oauth/does-not-exist', headers: { 'content-type': 'application/xml' }, payload: '<a/>' })
        const xml = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/xml' }, payload: '<a/>' })
        expect(xml.statusCode, url).toBe(404)
        expect(shape(xml, 'POST', url), url).toEqual(shape(unknown, 'POST', '/api/oauth/does-not-exist'))
        const unknownBad = await app.inject({ method: 'POST', url: '/api/nope', headers: { 'content-type': 'application/json' }, payload: '{' })
        const bad = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: '{' })
        // Fastify's global JSON parser rejects `{` with 400 on ANY path, so the invariant is "same as an unknown path", not a literal 404.
        expect(shape(bad, 'POST', url), url).toEqual(shape(unknownBad, 'POST', '/api/nope'))
      }
    })

    it('has no per-route rate limit: 61+ rapid requests never produce a 429', async () => {
      for (const [method, url] of ROUTES) {
        const codes = new Set<number>()
        for (let i = 0; i < 65; i++) codes.add((await app.inject({ method, url, payload: method === 'POST' ? {} : undefined })).statusCode)
        expect([...codes], url).toEqual([404])
      }
    })
  })

  it('needs no OAuth environment at all (no GOOGLE_*, no AUTH_SESSION_SECRET)', async () => {
    clearOauthEnv()
    delete process.env.AUTH_PROVIDER
    for (const k of Object.keys(process.env)) if (k.startsWith('GOOGLE_') || k === 'AUTH_SESSION_SECRET') delete process.env[k]
    await boot()
    for (const [method, url] of ROUTES) expect((await app.inject({ method, url, payload: method === 'POST' ? {} : undefined })).statusCode, url).toBe(404)
  })
})

describe('start', () => {
  beforeEach(() => boot())
  it('redirects to Google with state, nonce and an S256 challenge, and never caches', async () => {
    const { r, u } = await start('web')
    expect(r.statusCode).toBe(302)
    expect(r.headers['cache-control']).toMatch(/no-store/)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/oauth/google/callback`)
  })
  it('rejects a missing or unknown client kind with 400', async () => {
    for (const q of ['', '?client=tablet', '?client=']) expect((await app.inject({ method: 'GET', url: `/api/oauth/google/start${q}` })).statusCode).toBe(400)
  })
  it.each(['//evil.example', 'https://evil.example', '/\\evil', 'javascript:alert(1)'])('stores a safe return_to for %s', async (bad) => {
    await start('web', bad)
    expect((await pool.query('SELECT return_to FROM auth_flows')).rows[0].return_to).toBe('/')
  })
})

describe('full WEB flow', () => {
  beforeEach(() => boot())
  it('start -> callback -> exchange -> refresh -> logout, with tokens never in a URL', async () => {
    const s = await start('web', '/bid-tracker?sheet=pipeline#top')
    const cb = await callback(s.state)
    expect(cb.statusCode).toBe(302)
    const back = new URL(loc(cb))
    expect(back.origin).toBe(ORIGIN)
    expect(back.pathname + back.search.replace(/auth_code=[^&]+/, 'auth_code=X')).toBe('/bid-tracker?sheet=pipeline&auth_code=X')
    expect(back.hash).toBe('#top')
    expect(loc(cb)).not.toMatch(/access|refresh|token/i)
    const code = back.searchParams.get('auth_code')!

    // PKCE and nonce really were sent to Google the way start announced them
    expect(google.calls.exchange).toHaveLength(1)
    expect(pkceChallenge(google.calls.exchange[0].verifier)).toBe(s.challenge)
    expect(google.calls.verify[0].nonce).toBe(s.nonce)

    const ex = await post('/api/oauth/exchange', { code, client: 'web' })
    expect(ex.statusCode).toBe(200)
    expect(ex.headers['cache-control']).toMatch(/no-store/)
    const tokens = ex.json() as { accessToken: string; refreshToken: string; expiresIn: number }
    expect(tokens.expiresIn).toBe(900)
    await expect(verifyAccessToken(tokens.accessToken)).resolves.toMatchObject({ uid: 'g:1234567890', email: 'someone@amnex.com' })

    const rf = await post('/api/oauth/refresh', { refreshToken: tokens.refreshToken })
    expect(rf.statusCode).toBe(200)
    const next = rf.json() as typeof tokens
    expect(next.refreshToken).not.toBe(tokens.refreshToken)

    expect((await post('/api/oauth/refresh', { refreshToken: tokens.refreshToken })).statusCode).toBe(401) // reuse
    expect((await post('/api/oauth/refresh', { refreshToken: next.refreshToken })).statusCode).toBe(401)    // family revoked
  })
  it('logout revokes the session', async () => {
    const s = await start('web'); const code = new URL(loc(await callback(s.state))).searchParams.get('auth_code')!
    const t = (await post('/api/oauth/exchange', { code, client: 'web' })).json() as { refreshToken: string }
    expect((await post('/api/oauth/logout', { refreshToken: t.refreshToken })).statusCode).toBe(204)
    expect((await post('/api/oauth/refresh', { refreshToken: t.refreshToken })).statusCode).toBe(401)
    expect((await post('/api/oauth/logout', { refreshToken: 'nope' })).statusCode).toBe(204) // silent for unknown tokens
  })
})

describe('full APP flow', () => {
  beforeEach(() => boot())
  it('the callback is an HTML page that deep-links com.gorms.app://auth?code=… and nothing else secret', async () => {
    const s = await start('app')
    const cb = await callback(s.state)
    expect(cb.statusCode).toBe(200)
    expect(cb.headers['content-type']).toMatch(/text\/html/)
    expect(cb.headers['cache-control']).toMatch(/no-store/)
    expect(cb.headers['referrer-policy']).toBe('no-referrer')
    const m = cb.body.match(/com\.gorms\.app:\/\/auth\?code=([A-Za-z0-9_-]{43})/)
    expect(m).not.toBeNull()
    expect(cb.body).not.toMatch(/accessToken|refreshToken/)
    const ex = await post('/api/oauth/exchange', { code: m![1], client: 'app' })
    expect(ex.statusCode).toBe(200)
  })
  it('the dev API deep-links to the DEV scheme and never to the prod one (side-by-side installs, Q1)', async () => {
    process.env.OAUTH_APP_SCHEME = 'com.gorms.app.dev'
    const s = await start('app')
    const cb = await callback(s.state)
    expect(cb.body).toMatch(/com\.gorms\.app\.dev:\/\/auth\?code=[A-Za-z0-9_-]{43}/)
    expect(cb.body).not.toMatch(/com\.gorms\.app:\/\/auth/)
  })
  it('an unsupported OAUTH_APP_SCHEME is a generic 503 and issues no code', async () => {
    process.env.OAUTH_APP_SCHEME = 'evil.app'
    const s = await start('app')
    const cb = await callback(s.state)
    expect(cb.statusCode).toBe(503)
    expect(cb.body).not.toMatch(/evil|OAUTH_APP_SCHEME/)
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_exchange_codes')).rows[0].n).toBe(0)
  })
  it('an app code cannot be redeemed as web ...', async () => {
    const s = await start('app'); const code = (await callback(s.state)).body.match(/code=([A-Za-z0-9_-]{43})/)![1]
    expect((await post('/api/oauth/exchange', { code, client: 'web' })).statusCode).toBe(401)
    expect((await post('/api/oauth/exchange', { code, client: 'app' })).statusCode).toBe(200) // the failed attempt did not burn it
  })
  it('... and a web code cannot be redeemed as app', async () => {
    const s = await start('web'); const code = new URL(loc(await callback(s.state))).searchParams.get('auth_code')!
    expect((await post('/api/oauth/exchange', { code, client: 'app' })).statusCode).toBe(401)
    expect((await post('/api/oauth/exchange', { code, client: 'web' })).statusCode).toBe(200)
  })
})

describe('failure paths never issue a code or a token', () => {
  const codes = async () => (await pool.query('SELECT count(*)::int AS n FROM auth_exchange_codes')).rows[0].n
  const sessions = async () => (await pool.query('SELECT count(*)::int AS n FROM auth_sessions')).rows[0].n
  const reasonOf = (r: { headers: Record<string, unknown>; body: string }) =>
    r.headers.location ? new URL(String(r.headers.location)).searchParams.get('auth_error') : r.body.match(/auth\?error=([a-z]+)/)?.[1]

  it('unknown / replayed state -> reason "state", and the second visit of a good callback gets nothing', async () => {
    await boot()
    expect(reasonOf(await callback('forged-state'))).toBe('state')
    const s = await start('web')
    expect((await callback(s.state)).statusCode).toBe(302)
    const again = await callback(s.state) // back button / pasted URL
    expect(reasonOf(again)).toBe('state')
    expect(await codes()).toBe(1)
  })
  it('expired flow -> "state"', async () => {
    await boot()
    const s = await start('web')
    await pool.query(`UPDATE auth_flows SET expires_at = now() - interval '1 second'`)
    expect(reasonOf(await callback(s.state))).toBe('state')
    expect(await codes()).toBe(0)
  })
  it('the user denied consent at Google -> "denied"', async () => {
    await boot()
    const s = await start('web')
    const r = await app.inject({ method: 'GET', url: `/api/oauth/google/callback?error=access_denied&state=${encodeURIComponent(s.state)}` })
    expect(reasonOf(r)).toBe('denied')
    expect(await codes()).toBe(0)
  })
  it.each([['domain', 'domain'], ['unverified', 'unverified'], ['token', 'google'], ['nonce', 'google'], ['exchange', 'google']] as const)(
    'Google check "%s" -> reason "%s", no code, no session', async (fail, reason) => {
      await boot({ fail })
      const s = await start('web')
      expect(reasonOf(await callback(s.state))).toBe(reason)
      expect(await codes()).toBe(0); expect(await sessions()).toBe(0)
    })
  it('the app flow reports failures through the same deep link, with a reason only', async () => {
    await boot({ fail: 'domain' })
    const s = await start('app')
    const cb = await callback(s.state)
    expect(cb.body).toContain('com.gorms.app://auth?error=domain')
    expect(cb.body).not.toMatch(/code=/)
  })
  it('exchange refuses unknown, malformed and missing bodies with one generic 401/400', async () => {
    await boot()
    expect((await post('/api/oauth/exchange', { code: 'nope', client: 'web' })).statusCode).toBe(401)
    expect((await post('/api/oauth/exchange', {})).statusCode).toBe(400)
    expect((await post('/api/oauth/refresh', {})).statusCode).toBe(400)
  })
  it('two simultaneous exchanges of one code: exactly one gets tokens', async () => {
    await boot()
    const s = await start('web'); const code = new URL(loc(await callback(s.state))).searchParams.get('auth_code')!
    const rs = await Promise.all([post('/api/oauth/exchange', { code, client: 'web' }), post('/api/oauth/exchange', { code, client: 'web' })])
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 401])
    expect(await sessions()).toBe(1)
  })
  it('simultaneous refreshes over HTTP: one 200, the rest 401, family revoked', async () => {
    await boot()
    const s = await start('web'); const code = new URL(loc(await callback(s.state))).searchParams.get('auth_code')!
    const t = (await post('/api/oauth/exchange', { code, client: 'web' })).json() as { refreshToken: string }
    const rs = await Promise.all([1, 2, 3].map(() => post('/api/oauth/refresh', { refreshToken: t.refreshToken })))
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1)
    expect(rs.filter((r) => r.statusCode === 401)).toHaveLength(2)
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE revoked_at IS NULL')).rows[0].n).toBe(0)
  })
  it('a misconfigured server answers a generic 503 and leaks no variable values', async () => {
    await boot()
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    const r = await app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web' })
    expect(r.statusCode).toBe(503)
    expect(r.body).not.toMatch(/GOOGLE_OAUTH|test-client|secret/i)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toMatchObject({ event: 'oauth.misconfigured' })
  })
})

describe('failure logging and page safety', () => {
  it('logs exactly one JSON line with the reason code only (never state, code, email or Google text)', async () => {
    await boot({ fail: 'domain', email: 'leaky.person@amnex.com' })
    const s = await start('web')
    warnSpy.mockClear()
    const r = await callback(s.state, 'SECRET-GOOGLE-CODE-123')
    expect(new URL(loc(r)).searchParams.get('auth_error')).toBe('domain')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const line = String(warnSpy.mock.calls[0][0])
    expect(JSON.parse(line)).toEqual({ event: 'oauth.fail', reason: 'domain' })
    for (const secret of [s.state, 'SECRET-GOOGLE-CODE-123', 'leaky.person', 'amnex.com']) expect(line).not.toContain(secret)
  })
  it('an unknown state logs the "state" reason only', async () => {
    await boot()
    warnSpy.mockClear()
    await callback('forged-state-value')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const line = String(warnSpy.mock.calls[0][0])
    expect(JSON.parse(line)).toEqual({ event: 'oauth.fail', reason: 'state' })
    expect(line).not.toContain('forged-state-value')
  })
  it('request parameters never reach the app page (no injection through code/state/error/return_to)', async () => {
    await boot()
    const s = await start('app', '/x"><script>alert(1)</script>')
    const evil = encodeURIComponent('"><script>alert(1)</script>')
    const cb = await app.inject({ method: 'GET', url: `/api/oauth/google/callback?code=${evil}&state=${encodeURIComponent(s.state)}` })
    expect(cb.body).not.toContain('<script')
    expect(cb.body).not.toContain('alert(1)')
    const denied = await app.inject({ method: 'GET', url: `/api/oauth/google/callback?error=${evil}&state=${encodeURIComponent((await start('app')).state)}` })
    expect(denied.body).not.toContain('<script')
    expect(denied.body).toContain('com.gorms.app://auth?error=denied')
    expect(denied.headers['cache-control']).toMatch(/no-store/)
  })
})

describe('an unexpected server fault is a generic 500 with a reason-only log line (never the message, SQL or addresses)', () => {
  const SECRET = 'hunter2-SECRET'
  const GENERIC = { error: 'Sign-in is temporarily unavailable.' }
  const fault = () => Object.assign(new Error(`connect ECONNREFUSED 10.9.8.7:5432 password=${SECRET} relation "auth_flows" does not exist`), { code: 'ECONNREFUSED' })
  const newSession = () => startSession({ uid: 'g:1', email: 'someone@amnex.com', familyId: randomUUID() }).then((x) => x.refreshToken)
  const webCode = async () => new URL(loc(await callback((await start('web')).state))).searchParams.get('auth_code')!

  // `stub` is the dependency that throws on the route's first database use; `prepare` does the set-up, `run` is the request. Set up first, stub last.
  const ROUTES: Array<[string, 'query' | 'connect', () => Promise<() => ReturnType<typeof post>>]> = [
    ['start', 'query', async () => () => app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web' })],
    ['callback', 'query', async () => { const { state } = await start('web'); return () => callback(state) }],
    ['exchange', 'query', async () => { const code = await webCode(); return () => post('/api/oauth/exchange', { code, client: 'web' }) }],
    ['refresh', 'connect', async () => { const refreshToken = await newSession(); return () => post('/api/oauth/refresh', { refreshToken }) }],
    ['logout', 'query', async () => { const refreshToken = await newSession(); return () => post('/api/oauth/logout', { refreshToken }) }],
  ]
  beforeEach(() => boot())

  it.each(ROUTES)('%s: 500 + generic body, and ONE oauth.error line with route/name/code only', async (route, stub, prepare) => {
    const run = await prepare()
    errorSpy.mockClear()
    const spy = vi.spyOn(pool, stub).mockRejectedValueOnce(fault() as never)
    let r: Awaited<ReturnType<typeof run>>
    try { r = await run() } finally { spy.mockRestore() }
    expect(r.statusCode).toBe(500)
    expect(r.json()).toEqual(GENERIC)
    expect(r.headers['cache-control']).toMatch(/no-store/)
    for (const leak of [SECRET, 'ECONNREFUSED', '10.9.8.7', 'auth_flows', 'relation']) expect(r.body).not.toContain(leak)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = String(errorSpy.mock.calls[0][0])
    expect(JSON.parse(line)).toEqual({ event: 'oauth.error', route, name: 'Error', code: 'ECONNREFUSED' })
    for (const leak of [SECRET, '10.9.8.7', 'auth_flows', 'relation', 'password']) expect(line).not.toContain(leak)
  })
  it('a hostile `name`/`code`, or a thrown string, never reaches the log', async () => {
    for (const thrown of [
      Object.assign(new Error('x'), { name: `password=${SECRET}`, code: `password=${SECRET} 10.9.8.7` }),
      `connect failed password=${SECRET}`,
      undefined,
    ]) {
      errorSpy.mockClear()
      const spy = vi.spyOn(pool, 'query').mockRejectedValueOnce(thrown as never)
      let r: Awaited<ReturnType<typeof post>>
      try { r = await app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web' }) } finally { spy.mockRestore() }
      expect(r.statusCode).toBe(500)
      expect(r.json()).toEqual(GENERIC)
      expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toEqual({ event: 'oauth.error', route: 'start', name: 'unknown' })
      expect(String(errorSpy.mock.calls[0][0])).not.toContain(SECRET)
    }
  })
  it('the 500 is only for faults: bad requests stay 400, bad codes/tokens stay 401, misconfiguration stays 503', async () => {
    expect((await post('/api/oauth/exchange', {})).statusCode).toBe(400)
    expect((await post('/api/oauth/exchange', { code: 'nope', client: 'web' })).statusCode).toBe(401)
    expect((await post('/api/oauth/refresh', { refreshToken: 'x'.repeat(40) })).statusCode).toBe(401)
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    expect((await app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web' })).statusCode).toBe(503)
  })
})

describe('a missing or short AUTH_SESSION_SECRET answers 503 BEFORE any write', () => {
  const BREAK: Array<[string, () => void]> = [
    ['missing', () => { delete process.env.AUTH_SESSION_SECRET }],
    ['shorter than 32 bytes', () => { process.env.AUTH_SESSION_SECRET = 'too-short' }],
  ]
  const exchangeCodeRows = async () => (await pool.query('SELECT used_at FROM auth_exchange_codes')).rows
  const sessionRows = async () => (await pool.query('SELECT replaced_at, revoked_at FROM auth_sessions')).rows
  beforeEach(() => boot())

  describe.each(BREAK)('AUTH_SESSION_SECRET %s', (_label, breakSecret) => {
    it('exchange: 503, the one-time code is NOT consumed and no orphan session exists; once fixed, the same code works', async () => {
      const code = new URL(loc(await callback((await start('web')).state))).searchParams.get('auth_code')!
      breakSecret()
      const r = await post('/api/oauth/exchange', { code, client: 'web' })
      expect(r.statusCode).toBe(503)
      expect(r.json()).toEqual({ error: 'Sign-in is temporarily unavailable.' })
      expect(r.body).not.toMatch(/AUTH_SESSION_SECRET|too-short|bytes/)
      expect(await exchangeCodeRows()).toEqual([{ used_at: null }])
      expect(await sessionRows()).toEqual([])
      useOauthEnv('both')
      const ok = await post('/api/oauth/exchange', { code, client: 'web' })
      expect(ok.statusCode).toBe(200)
      expect(await sessionRows()).toHaveLength(1)
    })
    it('refresh: 503, the refresh token is NOT rotated (no replaced row, no new generation, family intact); once fixed, the SAME token still refreshes', async () => {
      const code = new URL(loc(await callback((await start('web')).state))).searchParams.get('auth_code')!
      const first = (await post('/api/oauth/exchange', { code, client: 'web' })).json() as { refreshToken: string }
      breakSecret()
      const r = await post('/api/oauth/refresh', { refreshToken: first.refreshToken })
      expect(r.statusCode).toBe(503)
      expect(r.body).not.toMatch(/AUTH_SESSION_SECRET|too-short|bytes/)
      expect(await sessionRows()).toEqual([{ replaced_at: null, revoked_at: null }])
      useOauthEnv('both')
      const ok = await post('/api/oauth/refresh', { refreshToken: first.refreshToken }) // NOT a reuse
      expect(ok.statusCode).toBe(200)
      expect((await sessionRows()).filter((x) => x.revoked_at !== null)).toHaveLength(0)
    })
  })
})

describe('the POST bodies are small: 4 KB limit on exchange, refresh and logout', () => {
  beforeEach(() => boot())
  const big = 'x'.repeat(8 * 1024)
  it.each([
    ['/api/oauth/exchange', { code: big, client: 'web' }],
    ['/api/oauth/refresh', { refreshToken: big }],
    ['/api/oauth/logout', { refreshToken: big }],
  ] as const)('%s rejects an 8 KB body with 413', async (url, payload) => {
    const r = await post(url, payload)
    expect(r.statusCode).toBe(413)
    expect(r.body).not.toContain(big.slice(0, 64))
  })
  it('an ordinary request body is far below the limit', async () => {
    const s = await start('web'); const code = new URL(loc(await callback(s.state))).searchParams.get('auth_code')!
    expect((await post('/api/oauth/exchange', { code, client: 'web' })).statusCode).toBe(200)
  })
})

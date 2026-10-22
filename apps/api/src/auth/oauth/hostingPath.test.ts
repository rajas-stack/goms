// apps/api/src/auth/oauth/hostingPath.test.ts
// The OAuth browser-binding design, exercised over REAL HTTP through a stand-in for the Firebase Hosting `/api/** -> Cloud Run` rewrite
// (see testHelpers/hostingProxy.ts for the two cookie rules it enforces and where they come from). The same file ran against the previous
// per-flow-cookie design as a negative control: every sign-in failed with auth_error=state behind this proxy.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../../app.js'
import { pool } from '../../db.js'
import { syncRbacNodes } from '../../lib/rbacTreeStore.js'
import { Browser, startHostingProxy, type HostingProxy } from '../../testHelpers/hostingProxy.js'
import { cleanupOauthTables, clearOauthEnv, fakeGoogle, gomsContextForEmail, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'

const ADMIN = 'admin@amnex.com'
let app: Awaited<ReturnType<typeof buildApp>>
let proxy: HostingProxy
let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
const browser = () => new Browser(proxy.origin)

beforeAll(async () => { useOauthEnv('both'); process.env.ADMIN_ALLOWED_EMAILS = ADMIN; await syncRbacNodes(null); clearOauthEnv(); delete process.env.ADMIN_ALLOWED_EMAILS })
beforeEach(async () => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useOauthEnv('both'); process.env.ADMIN_ALLOWED_EMAILS = ADMIN
  await cleanupOauthTables(); await pool.query('DELETE FROM email_oauth_flows')
  app = await buildApp({ oauth: { google: fakeGoogle().gateway }, rateLimit: { max: 10_000, timeWindow: '1 minute' } })
  await app.listen({ port: 0, host: '127.0.0.1' })
  proxy = await startHostingProxy((app.server.address() as AddressInfo).port)
})
afterEach(async () => {
  await proxy.close(); await app.close(); clearOauthEnv(); delete process.env.ADMIN_ALLOWED_EMAILS
  warnSpy.mockRestore(); errorSpy.mockRestore(); await cleanupOauthTables(); await pool.query('DELETE FROM email_oauth_flows')
})
afterAll(() => pool.end?.().catch(() => {}))

const stateOf = (r: Response) => new URL(r.headers.get('location')!).searchParams.get('state')!
const start = async (b: Browser, client: 'web' | 'app' = 'web') => {
  const r = await b.request(`/api/oauth/google/start?client=${client}&return_to=%2Femail`)
  expect(r.status).toBe(302)
  return stateOf(r)
}
const callback = (b: Browser, state: string, query = 'code=google-code') => b.request(`/api/oauth/google/callback?${query}&state=${encodeURIComponent(state)}`)
const codeOf = (r: Response) => new URL(r.headers.get('location')!).searchParams.get('auth_code')!
const exchange = (b: Browser, code: string) => b.request('/api/oauth/exchange', { method: 'POST', body: { code, client: 'web' } })
const failedWithState = (r: Response) => r.status === 302 && r.headers.get('location')!.includes('auth_error=state')

describe('the harness itself reproduces the two Hosting cookie rules', () => {
  it('forwards ONLY __session to the backend: other cookies, including the old per-flow names, never arrive', async () => {
    const b = browser()
    await start(b)
    b.plant('_ga', 'GA1.2.3'); b.plant('goms_login_0123456789abcdef', 'legacy'); b.plant('__Host-goms_exchange_0123456789abcdef', 'legacy')
    await b.request('/api/oauth/google/start?client=web')
    expect(proxy.lastBackendCookie()).toMatch(/^__session=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/)
    expect(proxy.lastBackendCookie()).not.toMatch(/_ga|goms_login|goms_exchange/)
  })
  it('drops Set-Cookie from a response without Cache-Control private, but passes it with private', async () => {
    const { createServer } = await import('node:http')
    const origin = createServer((req, res) => {
      res.setHeader('Set-Cookie', 'x=1; Path=/')
      if (req.url === '/private') res.setHeader('Cache-Control', 'private, no-store'); else res.setHeader('Cache-Control', 'no-store')
      res.end('ok')
    })
    await new Promise<void>(done => origin.listen(0, '127.0.0.1', done))
    const probe = await startHostingProxy((origin.address() as AddressInfo).port)
    try {
      expect((await fetch(probe.origin + '/private')).headers.getSetCookie()).toHaveLength(1)
      expect((await fetch(probe.origin + '/plain')).headers.getSetCookie()).toHaveLength(0)
      expect(probe.strippedSetCookies()).toBe(1)
    } finally { await probe.close(); await new Promise<void>(done => origin.close(() => done())) }
  })
})

describe('Google sign-in through the Hosting rewrite', () => {
  it('web: start -> callback -> exchange -> refresh -> logout, and a replayed code is refused', async () => {
    const a = browser()
    const state = await start(a)
    expect([...a.jar.keys()]).toEqual(['__session'])
    const cb = await callback(a, state)
    expect(cb.status).toBe(302)
    const code = codeOf(cb)
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const ex = await exchange(a, code)
    expect(ex.status).toBe(200)
    const tokens = await ex.json() as { accessToken: string; refreshToken: string }
    expect((await exchange(a, code)).status).toBe(401) // replay
    expect((await callback(a, state)).headers.get('location')).toContain('auth_error=state') // replayed state
    const refreshed = await a.request('/api/oauth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } })
    expect(refreshed.status).toBe(200)
    const next = await refreshed.json() as { refreshToken: string }
    expect((await a.request('/api/oauth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } })).status).toBe(401) // reuse revokes the family
    expect((await a.request('/api/oauth/refresh', { method: 'POST', body: { refreshToken: next.refreshToken } })).status).toBe(401)
    expect(proxy.strippedSetCookies()).toBe(0) // every Set-Cookie survived the proxy
  })
  it('web: logout revokes the session', async () => {
    const a = browser()
    const tokens = await (await exchange(a, codeOf(await callback(a, await start(a))))).json() as { refreshToken: string }
    expect((await a.request('/api/oauth/logout', { method: 'POST', body: { refreshToken: tokens.refreshToken } })).status).toBe(204)
    expect((await a.request('/api/oauth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } })).status).toBe(401)
  })
  it('app (Custom Tab): the code page is issued to the starting browser only', async () => {
    const a = browser(), other = browser()
    await start(other, 'app')
    const state = await start(a, 'app')
    // The state's client kind is unknown until the flow is consumed, so a binding mismatch answers like any other bad state: a web redirect.
    expect(failedWithState(await callback(other, state))).toBe(true)
    const ok = await callback(a, state)
    expect(ok.status).toBe(200); expect(await ok.text()).toMatch(/code=[A-Za-z0-9_-]{43}/)
  })
})

describe('browser binding: cross-browser rejection and replay prevention', () => {
  it('a callback opened in another browser is refused and does not consume the legitimate flow', async () => {
    const a = browser(), attacker = browser()
    const state = await start(a)
    expect(failedWithState(await callback(new Browser(proxy.origin), state))).toBe(true) // no cookie at all
    await start(attacker)
    expect(failedWithState(await callback(attacker, state))).toBe(true) // the attacker has a session cookie of their own
    const cb = await callback(a, state)
    expect(cb.status).toBe(302); expect(cb.headers.get('location')).toContain('auth_code=')
  })
  it('an exchange code pasted into another browser is refused, and still works once in its own browser', async () => {
    const a = browser(), attacker = browser()
    const code = codeOf(await callback(a, await start(a)))
    await start(attacker)
    expect((await exchange(attacker, code)).status).toBe(401)
    expect((await exchange(new Browser(proxy.origin), code)).status).toBe(401)
    expect((await exchange(a, code)).status).toBe(200)
    expect((await exchange(a, code)).status).toBe(401)
  })
  it('a forged, tampered or legacy-style cookie grants nothing', async () => {
    const a = browser()
    const state = await start(a)
    const attacker = browser()
    attacker.plant('__session', 'a'.repeat(43) + '.' + 'b'.repeat(43), '/api')
    expect(failedWithState(await callback(attacker, state))).toBe(true)
    attacker.plant('goms_login_0123456789abcdef', 'x')
    expect(failedWithState(await callback(attacker, state))).toBe(true)
    expect((await callback(a, state)).status).toBe(302)
  })
  it('several concurrent sign-ins from one browser all complete, in any order', async () => {
    const a = browser()
    const first = await start(a) // mints the browser id
    const rest = await Promise.all([start(a), start(a), start(a)])
    const states = [first, ...rest]
    const done = []
    for (const state of [...states].reverse()) done.push(await callback(a, state))
    expect(done.map(r => r.status)).toEqual([302, 302, 302, 302])
    expect(done.every(r => r.headers.get('location')!.includes('auth_code='))).toBe(true)
  })
})

describe('Email Center and Profile Images connections through the Hosting rewrite', () => {
  const connect = async (b: Browser, path: 'emailCenter.connect' | 'profileImages.connect', body?: unknown) => {
    const { authHeader } = await gomsContextForEmail(ADMIN)
    const r = await b.request(`/api/trpc/${path}`, { method: 'POST', body: body ?? (path === 'emailCenter.connect' ? { returnTo: '/bid-tracker' } : {}), headers: { authorization: authHeader } })
    expect(r.status).toBe(200)
    const url = new URL(((await r.json()) as any).result.data.url)
    return url.searchParams.get('state')!
  }
  it('Gmail: the begin call sets the shared cookie, the callback in the same browser passes, another browser is refused', async () => {
    const a = browser(), other = browser()
    const state = await connect(a, 'emailCenter.connect')
    expect(state).toMatch(/^mail\.[A-Za-z0-9_-]{43}$/)
    expect([...a.jar.keys()]).toEqual(['__session'])
    await connect(other, 'emailCenter.connect')
    const foreign = await callback(other, state, 'error=access_denied')
    expect(foreign.status).toBe(400); expect(await foreign.text()).toContain('does not belong to this browser')
    const own = await callback(a, state, 'error=access_denied')
    expect(own.status).toBe(302); expect(own.headers.get('location')).toContain('email_connection=cancelled')
    expect((await callback(a, state, 'error=access_denied')).status).toBe(400) // single use
    expect(proxy.strippedSetCookies()).toBe(0)
  })
  it('Profile Images: same guarantees', async () => {
    const a = browser(), other = browser()
    const state = await connect(a, 'profileImages.connect')
    expect(state).toMatch(/^profile\.[A-Za-z0-9_-]{43}$/)
    await connect(other, 'profileImages.connect')
    expect((await callback(other, state, 'error=access_denied')).status).toBe(400)
    const own = await callback(a, state, 'error=access_denied')
    expect(own.status).toBe(302); expect(own.headers.get('location')).toContain('profile_connection=cancelled')
  })
  it('a sign-in, a Gmail connection and a Profile Images connection can be in progress in one browser at once', async () => {
    const a = browser()
    const login = await start(a)
    const mail = await connect(a, 'emailCenter.connect')
    const profile = await connect(a, 'profileImages.connect')
    expect([...a.jar.keys()]).toEqual(['__session']) // one cookie, one id, shared by all three
    expect((await callback(a, profile, 'error=access_denied')).headers.get('location')).toContain('profile_connection=cancelled')
    expect((await callback(a, login)).headers.get('location')).toContain('auth_code=')
    expect((await callback(a, mail, 'error=access_denied')).headers.get('location')).toContain('email_connection=cancelled')
  })
})

describe('the cookie confers no authority', () => {
  it('a valid __session without a Bearer token is still unauthenticated', async () => {
    const a = browser()
    await start(a)
    const r = await a.request('/api/trpc/emailCenter.status')
    expect(r.status).toBe(401)
    expect(((await r.json()) as any).error.data.code).toBe('UNAUTHORIZED')
  })
  it('is scoped to /api and is not sent to the rest of the site', async () => {
    const a = browser()
    await start(a)
    expect(a.cookieHeader('/api/oauth/exchange')).toMatch(/^__session=/)
    expect(a.cookieHeader('/bid-tracker')).toBeUndefined()
  })
})

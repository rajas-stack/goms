// apps/api/src/auth/oauth/oauthRateLimit.test.ts
// The per-IP rate limit on the five OAuth endpoints (start, callback, exchange, refresh, logout): its default (60 per 5 minutes), the narrow
// AUTH_OAUTH_RATE_LIMIT_MAX override (1..300, anything else falls back to 60 and can never switch limiting off), and how it relates to the
// app-wide limit (300 per 5 minutes per IP).
//
// The relationship is the point of the last two groups. A route that sets its own limit is governed ONLY by it: Fastify's rate-limit plugin
// attaches either the route's limiter or the global one, never both. So the app-wide 300 limit does NOT also apply to the OAuth endpoints, and
// the two budgets are independent in the other direction only (exhausting one does not touch the other). These tests state that as it is.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../app.js'
import { pool } from '../../db.js'
import { cleanupOauthTables, clearOauthEnv, fakeGoogle, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { OAUTH_RATE_LIMIT_CEILING, OAUTH_RATE_LIMIT_DEFAULT, oauthRateLimitMax } from './config.js'

let warn: ReturnType<typeof vi.spyOn>
let apps: Awaited<ReturnType<typeof buildApp>>[] = []
beforeEach(async () => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); useOauthEnv('both'); await cleanupOauthTables() })
afterEach(async () => { await Promise.all(apps.map(a => a.close())); apps = []; delete process.env.AUTH_OAUTH_RATE_LIMIT_MAX; clearOauthEnv(); warn.mockRestore(); await cleanupOauthTables() })
afterAll(() => pool.end?.().catch(() => {}))

/** An app with the PRODUCTION limiter defaults (no rateLimit override), behind the Hosting client-IP header, reading the env as set at call time. */
async function boot(limit?: string) {
  if (limit === undefined) delete process.env.AUTH_OAUTH_RATE_LIMIT_MAX; else process.env.AUTH_OAUTH_RATE_LIMIT_MAX = limit
  const app = await buildApp({ oauth: { google: fakeGoogle().gateway }, trustProxy: 'firebase-hosting' })
  apps.push(app)
  return app
}
type App = Awaited<ReturnType<typeof boot>>
const ENDPOINTS = {
  start: (app: App, ip: string) => app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web', headers: { 'fastly-client-ip': ip } }),
  callback: (app: App, ip: string) => app.inject({ method: 'GET', url: '/api/oauth/google/callback?code=x&state=not-a-real-state', headers: { 'fastly-client-ip': ip } }),
  exchange: (app: App, ip: string) => app.inject({ method: 'POST', url: '/api/oauth/exchange', payload: { code: 'x', client: 'web' }, headers: { 'fastly-client-ip': ip } }),
  refresh: (app: App, ip: string) => app.inject({ method: 'POST', url: '/api/oauth/refresh', payload: { refreshToken: 'x' }, headers: { 'fastly-client-ip': ip } }),
  logout: (app: App, ip: string) => app.inject({ method: 'POST', url: '/api/oauth/logout', payload: { refreshToken: 'x' }, headers: { 'fastly-client-ip': ip } }),
} as const
const NAMES = Object.keys(ENDPOINTS) as (keyof typeof ENDPOINTS)[]
const health = (app: App, ip: string) => app.inject({ method: 'GET', url: '/api/trpc/health.check', headers: { 'fastly-client-ip': ip } })
/** How many of the next `n` calls were answered 429. */
async function tooMany(n: number, call: () => Promise<{ statusCode: number }>): Promise<{ accepted: number; throttled: number; firstThrottledAt: number | null }> {
  let accepted = 0, throttled = 0, first: number | null = null
  for (let i = 1; i <= n; i++) { if ((await call()).statusCode === 429) { throttled++; first ??= i } else accepted++ }
  return { accepted, throttled, firstThrottledAt: first }
}

describe('AUTH_OAUTH_RATE_LIMIT_MAX parsing', () => {
  it('has a default of 60 and a hard ceiling of 300 (the app-wide figure)', () => {
    expect(OAUTH_RATE_LIMIT_DEFAULT).toBe(60); expect(OAUTH_RATE_LIMIT_CEILING).toBe(300)
  })
  it.each([[undefined, 60], ['', 60], ['   ', 60], ['60', 60], ['1', 1], ['25', 25], ['40', 40], [' 25 ', 25], ['299', 299], ['300', 300]] as const)(
    '%j -> %i, silently', (raw, expected) => { expect(oauthRateLimitMax(raw)).toBe(expected); expect(warn).not.toHaveBeenCalled() })
  it.each(['0', '-1', '-60', '+60', '060', '60.5', '1e3', '0x3c', '301', '1000', '999999', 'abc', 'Infinity', 'NaN', 'null', 'undefined', 'false', 'off', 'unlimited', 'none', '60 60', '6,0', '١٢'])(
    '%j is invalid: falls back to 60 with one value-free warning', (raw) => {
      expect(oauthRateLimitMax(raw)).toBe(60)
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0][0])
      expect(line).toBe(JSON.stringify({ event: 'auth.invalid_oauth_rate_limit', using: 60 })) // exactly this line: the rejected value is not echoed
    })
  it('can never produce a value outside 1..300', () => {
    for (const raw of ['0', '1', '300', '301', '-5', 'x', '', '2.5', '99999999999999999999']) { const n = oauthRateLimitMax(raw); expect(Number.isInteger(n) && n >= 1 && n <= 300).toBe(true) }
  })
})

describe('the default limit (variable unset): 60 per IP per endpoint per 5 minutes', () => {
  it.each(NAMES)('%s: the first 60 requests pass, the 61st and later are 429, another IP is unaffected', async (name) => {
    const app = await boot()
    const r = await tooMany(70, () => ENDPOINTS[name](app, '203.0.113.1'))
    expect(r).toEqual({ accepted: 60, throttled: 10, firstThrottledAt: 61 })
    expect((await ENDPOINTS[name](app, '203.0.113.2')).statusCode).not.toBe(429)
  })
})

describe('the override', () => {
  it.each(NAMES)('AUTH_OAUTH_RATE_LIMIT_MAX=5 limits %s to 5 per IP', async (name) => {
    const app = await boot('5')
    expect(await tooMany(8, () => ENDPOINTS[name](app, '203.0.113.1'))).toEqual({ accepted: 5, throttled: 3, firstThrottledAt: 6 })
    expect((await ENDPOINTS[name](app, '203.0.113.2')).statusCode).not.toBe(429)
  })
  it('300 is accepted and is the most that can be set: 300 pass, the 301st is 429', async () => {
    const app = await boot('300')
    expect(await tooMany(303, () => ENDPOINTS.refresh(app, '203.0.113.1'))).toEqual({ accepted: 300, throttled: 3, firstThrottledAt: 301 })
  })
  it.each(['0', '-1', 'abc', '60.5', '1e3', '301', '999999', 'false', 'off', 'unlimited', 'Infinity'])(
    'an invalid value (%j) leaves the limit at 60 on every endpoint: it neither disables nor loosens limiting, and warns once at boot', async (bad) => {
      const app = await boot(bad)
      expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('auth.invalid_oauth_rate_limit'))).toHaveLength(1)
      for (const name of NAMES) expect(await tooMany(63, () => ENDPOINTS[name](app, `198.51.100.${NAMES.indexOf(name) + 1}`))).toEqual({ accepted: 60, throttled: 3, firstThrottledAt: 61 })
    })
  it('the setting is read when the app boots: a later change does not alter a running app', async () => {
    const app = await boot('5')
    process.env.AUTH_OAUTH_RATE_LIMIT_MAX = '200'
    expect(await tooMany(8, () => ENDPOINTS.start(app, '203.0.113.1'))).toEqual({ accepted: 5, throttled: 3, firstThrottledAt: 6 })
  })
})

describe('the app-wide limit (300 per IP per 5 minutes) and the OAuth limit are separate budgets', () => {
  it('exhausting an OAuth endpoint does not use up any of the app-wide budget, which stays exactly 300', async () => {
    const app = await boot()
    expect((await tooMany(70, () => ENDPOINTS.start(app, '203.0.113.1'))).throttled).toBe(10)
    expect(await tooMany(303, () => health(app, '203.0.113.1'))).toEqual({ accepted: 300, throttled: 3, firstThrottledAt: 301 })
  })
  it('exhausting the app-wide budget does not stop the OAuth endpoints, which keep their own 60', async () => {
    const app = await boot()
    expect((await tooMany(303, () => health(app, '203.0.113.1'))).firstThrottledAt).toBe(301)
    expect(await tooMany(63, () => ENDPOINTS.start(app, '203.0.113.1'))).toEqual({ accepted: 60, throttled: 3, firstThrottledAt: 61 })
  })
  it('the OAuth override does not change the app-wide limit: still 300 with the override at its minimum and at its maximum', async () => {
    for (const setting of ['1', '300']) {
      const app = await boot(setting)
      expect(await tooMany(302, () => health(app, `192.0.2.${setting === '1' ? 1 : 2}`))).toEqual({ accepted: 300, throttled: 2, firstThrottledAt: 301 })
    }
  })
})

describe('KNOWN LIMIT (characterisation, not a wish): the app-wide 300 does NOT also apply to the OAuth endpoints', () => {
  // These two tests pin down why raising the override above 60 cannot be justified by "the global limit still applies": it does not apply to
  // these routes at all. Only each endpoint's own counter does, so one IP's combined OAuth ceiling is (number of endpoints) x (the setting).
  it('at the default 60 the five endpoints together admit exactly 300 per IP per 5 minutes, the same figure as the app-wide limit', async () => {
    const app = await boot()
    let accepted = 0
    for (const name of NAMES) accepted += (await tooMany(61, () => ENDPOINTS[name](app, '203.0.113.1'))).accepted
    expect(accepted).toBe(5 * 60)
    expect(accepted).toBe(300)
  })
  it('at 300 one IP gets 1500 OAuth requests through in 5 minutes across the five endpoints, far above the app-wide 300 (no combined ceiling applies)', async () => {
    const app = await boot('300')
    let accepted = 0, throttled = 0
    for (const name of NAMES) { const r = await tooMany(301, () => ENDPOINTS[name](app, '203.0.113.1')); accepted += r.accepted; throttled += r.throttled }
    expect(accepted).toBe(5 * 300)
    expect(throttled).toBe(5) // each endpoint stops only at its own 301st request
    expect(accepted).toBeGreaterThan(OAUTH_RATE_LIMIT_CEILING) // i.e. the app-wide 300 did not bound it
  })
})

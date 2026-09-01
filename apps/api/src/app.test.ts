import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { FastifyInstance } from 'fastify'
import type { AppRouter } from './index.js'
import { buildApp } from './app.js'
import { pool } from './db.js'
import { fakeIdToken, AUTHORIZED_TEST_EMAIL } from './testHelpers/adminImportTestAuth.js'

// Routes an httpBatchLink `fetch` call straight into the Fastify instance via
// `.inject()` — no real socket/port needed, and it exercises the exact same
// batching wire format the real frontend's RemoteRepository uses.
function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const headers: Record<string, string> = {}
    if (init?.headers) {
      for (const [key, value] of new Headers(init.headers as ConstructorParameters<typeof Headers>[0])) headers[key] = value
    }
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: path,
      headers,
      payload: init?.body as string | undefined,
    })
    const headerEntries = Object.entries(res.headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)] as [string, string])
    return new Response(res.rawPayload, { status: res.statusCode, headers: headerEntries })
  }) as typeof fetch
}

describe('rate limiting', () => {
  it('allows requests under the configured limit', async () => {
    const app = await buildApp({ rateLimit: { max: 5, timeWindow: '1 minute' } })
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/trpc/health.check' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).result.data).toEqual({ ok: true, db: 'connected' })
    }
    await app.close()
  })

  it('returns 429 with the standard rate-limit error shape once the limit is exceeded', async () => {
    const app = await buildApp({ rateLimit: { max: 3, timeWindow: '1 minute' } })
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/trpc/health.check' })
      expect(res.statusCode).toBe(200)
    }
    const blocked = await app.inject({ method: 'GET', url: '/api/trpc/health.check' })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()
    const body = JSON.parse(blocked.payload)
    expect(body.statusCode).toBe(429)
    expect(body.error).toBe('Too Many Requests')
    await app.close()
  })

  it('counts a batched tRPC request (many procedures) as exactly one request against the limit', async () => {
    // Mirrors the 2026-08-26 dev cutover incident: the Home page batches 6-7
    // procedures into one HTTP request via httpBatchLink. If the limiter ever
    // counted per-procedure instead of per-HTTP-request, a page like that
    // would burn through the whole budget on a single load.
    const app = await buildApp({ rateLimit: { max: 2, timeWindow: '1 minute' } })
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: 'http://test/api/trpc', fetch: injectFetch(app) })],
    })

    // One HTTP request bundling 6 procedure calls (same shape as the real
    // Home page batch) — must succeed, and must only cost 1 of the 2 allowed.
    const batchResults = await Promise.all(Array.from({ length: 6 }, () => client.health.check.query()))
    for (const result of batchResults) expect(result).toEqual({ ok: true, db: 'connected' })

    // A second, separate HTTP request — still within budget (2nd of 2).
    const second = await app.inject({ method: 'GET', url: '/api/trpc/health.check' })
    expect(second.statusCode).toBe(200)

    // A third HTTP request — now over budget. If the 6-procedure batch above
    // had been counted per-procedure instead of per-request, the limit would
    // already have been blown well before this point.
    const third = await app.inject({ method: 'GET', url: '/api/trpc/health.check' })
    expect(third.statusCode).toBe(429)

    await app.close()
  })

  it('does not regress existing API behavior: CORS + health.check response stay correct alongside the limiter', async () => {
    const app = await buildApp({ rateLimit: { max: 300, timeWindow: '5 minutes' } })
    const res = await app.inject({
      method: 'GET',
      url: '/api/trpc/health.check',
      headers: { origin: 'http://localhost:5173' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(JSON.parse(res.payload).result.data).toEqual({ ok: true, db: 'connected' })
    await app.close()
  })

  it('applies the documented production defaults (300 req / 5 min) when no override is given', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/trpc/health.check' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBe('300')
    await app.close()
  })
})

describe('admin import feature gate', () => {
  afterEach(() => {
    delete process.env.ADMIN_IMPORT_ENABLED
    delete process.env.ADMIN_IMPORT_ALLOWED_EMAILS
  })

  it('returns 404 from adminImport routes when ADMIN_IMPORT_ENABLED is not set', async () => {
    delete process.env.ADMIN_IMPORT_ENABLED
    const app = await buildApp()
    // GET, matching listDomains' .query() type — tRPC's fastify adapter
    // expects GET for queries/POST for mutations, so this must match or the
    // request fails on a method mismatch before ever reaching
    // adminImportProcedure's gate, which would test the wrong thing.
    const res = await app.inject({ method: 'GET', url: '/api/trpc/adminImport.listDomains' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns 401 when the flag is on but no Authorization header is sent', async () => {
    process.env.ADMIN_IMPORT_ENABLED = 'true'
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/trpc/adminImport.listDomains' })
    const body = JSON.parse(res.payload)
    expect(body.error.data.code).toBe('UNAUTHORIZED')
    await app.close()
  })

  it('returns 403 for a signed-in caller who is not on the allow-list', async () => {
    process.env.ADMIN_IMPORT_ENABLED = 'true'
    process.env.ADMIN_IMPORT_ALLOWED_EMAILS = AUTHORIZED_TEST_EMAIL
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/trpc/adminImport.listDomains',
      headers: { authorization: `Bearer ${fakeIdToken({ email: 'someone-else@gmail.com' })}` },
    })
    const body = JSON.parse(res.payload)
    expect(body.error.data.code).toBe('FORBIDDEN')
    await app.close()
  })

  it('serves adminImport routes for a signed-in, allow-listed caller', async () => {
    process.env.ADMIN_IMPORT_ENABLED = 'true'
    process.env.ADMIN_IMPORT_ALLOWED_EMAILS = AUTHORIZED_TEST_EMAIL
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/trpc/adminImport.listDomains',
      headers: { authorization: `Bearer ${fakeIdToken()}` },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

describe('error sanitization', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replaces an unhandled internal error message with a generic one over HTTP, never the raw driver error', async () => {
    // health.check's `await pool.query('SELECT 1')` has no try/catch of its
    // own — an error here becomes an uncaught throw, which is exactly the
    // "raw pg driver error escapes as INTERNAL_SERVER_ERROR" case this fix
    // targets (see trpc.ts's errorFormatter). A real connection failure's
    // message can contain a hostname/credential hint, e.g. this shape.
    const rawMessage = 'password authentication failed for user "goms_admin" at host 10.10.0.5'
    vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error(rawMessage))

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/trpc/health.check' })

    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.payload)
    expect(body.error.message).toBe('Internal server error')
    expect(body.error.message).not.toContain('goms_admin')
    expect(body.error.message).not.toContain('10.10.0.5')
    await app.close()
  })

  it('leaves a deliberate, non-internal TRPCError message untouched over HTTP', async () => {
    // Contrast case: a BAD_REQUEST from zod's own input validation (e.g.
    // customers.get called with a malformed id) is not INTERNAL_SERVER_ERROR
    // and must reach the client with its real, purpose-written message —
    // only the auto-wrapped INTERNAL_SERVER_ERROR case (above) is sanitized.
    // No DB dependency: input validation runs before any query is issued.
    const app = await buildApp()
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: 'http://test/api/trpc', fetch: injectFetch(app) })],
    })

    await expect(client.customers.get.query({ id: 'not-a-uuid' })).rejects.toThrow(/uuid/i)
    await app.close()
  })
})

describe('proxy trust and per-client rate-limit keying', () => {
  // Registers a DB-free probe route so these tests exercise the real Fastify
  // request pipeline (and the real rate-limit hook) without needing Postgres.
  async function buildProbeApp(opts: Parameters<typeof buildApp>[0] = {}) {
    const app = await buildApp(opts)
    app.get('/__probe', async (request) => ({ ip: request.ip }))
    return app
  }

  // The shape Firebase Hosting's `/api/**` rewrite actually delivers to Cloud
  // Run: X-Forwarded-For holds Google/Fastly CDN addresses that are identical
  // for every visitor, and the real caller is in Fastly-Client-IP.
  const CDN_FORWARDED_FOR = '35.192.2.154, 35.192.2.154'

  it('ignores forwarding headers by default, keeping request.ip the socket address', async () => {
    const app = await buildProbeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/__probe',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    })
    expect(JSON.parse(res.payload).ip).toBe('10.0.0.1')
    await app.close()
  })

  it('makes request.ip proxy-aware when TRUST_PROXY selects firebase-hosting', async () => {
    const app = await buildProbeApp({ trustProxy: 'firebase-hosting' })
    const res = await app.inject({
      method: 'GET',
      url: '/__probe',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    })
    expect(JSON.parse(res.payload).ip).toBe('203.0.113.7')
    await app.close()
  })

  it('gives each real caller its own budget behind the Firebase Hosting rewrite', async () => {
    // THE BUG: with no trustProxy/keyGenerator, every request through the
    // rewrite arrives from the same Google front-end address, so all of the
    // internet shared one 300-per-5-minutes bucket. Two different visitors
    // must not exhaust each other's budget.
    const app = await buildProbeApp({
      trustProxy: 'firebase-hosting',
      rateLimit: { max: 1, timeWindow: '1 minute' },
    })
    const request = (clientIp: string) =>
      app.inject({
        method: 'GET',
        url: '/__probe',
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': CDN_FORWARDED_FOR, 'fastly-client-ip': clientIp },
      })

    expect((await request('203.0.113.7')).statusCode).toBe(200)
    expect((await request('198.51.100.4')).statusCode).toBe(200)
    expect((await request('2001:db8::1')).statusCode).toBe(200)
    await app.close()
  })

  it('still limits a single real caller behind the rewrite', async () => {
    // The other half of the fix: per-caller budgets must not mean no budget.
    const app = await buildProbeApp({
      trustProxy: 'firebase-hosting',
      rateLimit: { max: 2, timeWindow: '1 minute' },
    })
    const request = () =>
      app.inject({
        method: 'GET',
        url: '/__probe',
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': CDN_FORWARDED_FOR, 'fastly-client-ip': '203.0.113.7' },
      })

    expect((await request()).statusCode).toBe(200)
    expect((await request()).statusCode).toBe(200)
    const blocked = await request()
    expect(blocked.statusCode).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()
    await app.close()
  })

  it('does not honour a client-supplied IP header when proxy trust is off', async () => {
    // A direct caller must not be able to mint fresh budgets just by varying
    // a header on a deployment that is not behind the rewrite.
    const app = await buildProbeApp({ rateLimit: { max: 1, timeWindow: '1 minute' } })
    const request = (clientIp: string) =>
      app.inject({
        method: 'GET',
        url: '/__probe',
        remoteAddress: '10.0.0.1',
        headers: { 'fastly-client-ip': clientIp },
      })

    expect((await request('203.0.113.7')).statusCode).toBe(200)
    expect((await request('198.51.100.4')).statusCode).toBe(429)
    await app.close()
  })

  it('falls back to request.ip for a malformed client-IP header instead of keying on it', async () => {
    // Guards the rate-limit store's key space: junk header values must collapse
    // onto one key, not create an unbounded set of them.
    const app = await buildProbeApp({
      trustProxy: 'firebase-hosting',
      rateLimit: { max: 1, timeWindow: '1 minute' },
    })
    const request = (clientIp: string) =>
      app.inject({
        method: 'GET',
        url: '/__probe',
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.7', 'fastly-client-ip': clientIp },
      })

    expect((await request('junk-value-one')).statusCode).toBe(200)
    expect((await request('junk-value-two')).statusCode).toBe(429)
    await app.close()
  })

  it('reads TRUST_PROXY from the environment when no override is passed', async () => {
    process.env.TRUST_PROXY = 'firebase-hosting'
    try {
      const app = await buildProbeApp()
      const res = await app.inject({
        method: 'GET',
        url: '/__probe',
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.7' },
      })
      expect(JSON.parse(res.payload).ip).toBe('203.0.113.7')
      await app.close()
    } finally {
      delete process.env.TRUST_PROXY
    }
  })
})

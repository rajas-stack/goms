// apps/api/src/auth/oauth/routes.ts
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { signAccessToken } from './accessToken.js'
import { OAuthConfigError, appScheme, oauthConfig, oauthEnabled, sessionKey } from './config.js'
import { createExchangeCode, redeemExchangeCode } from './exchangeCodes.js'
import { consumeFlow, createFlow } from './flows.js'
import { GoogleAuthError, buildAuthUrl, type GoogleGateway } from './googleClient.js'
import { parseClient, safeReturnTo, webRedirectUrl, type ClientKind } from './redirect.js'
import { SessionError, revokeFamilyByRefreshToken, rotateRefreshToken, startSession } from './sessions.js'

export interface OAuthDeps { google: GoogleGateway }

type Reason = 'state' | 'domain' | 'unverified' | 'google' | 'denied'
const reasonFor = (e: unknown): Reason => {
  if (e instanceof GoogleAuthError) return e.reason === 'domain' ? 'domain' : e.reason === 'unverified' ? 'unverified' : 'google'
  return 'google'
}

/** A log label only if it is a short identifier-like token; anything else (free text, a message that ended up in `name`/`code`) is dropped. */
const safeLabel = (v: unknown): string | undefined => (typeof v === 'string' && /^[A-Za-z0-9_.-]{1,48}$/.test(v) ? v : undefined)

const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').header('Referrer-Policy', 'no-referrer')
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'Not found' })

/** The page an Android Custom Tab lands on. `scheme` is this deployment's own app scheme (`appScheme()`), so a dev API can only open the dev app. A meta refresh plus a visible link (browsers may refuse an unprompted custom-scheme
 *  redirect). It carries a one-time code or a reason code — never a token. Values are base64url or a fixed word, so no escaping is needed. */
function appPage(scheme: string, query: string): string {
  // Defence in depth: the only values ever passed are our own 43-char base64url code or a fixed reason word.
  if (!/^(code=[A-Za-z0-9_-]{43}|error=(state|domain|unverified|google|denied))$/.test(query)) throw new Error('invalid app page query')
  const href = `${scheme}://auth?${query}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="refresh" content="0;url=${href}"><title>Return to GOMS</title>`
    + `<style>body{font:16px system-ui;margin:2rem;text-align:center}a{display:inline-block;margin-top:1rem;padding:.8rem 1.4rem;background:#111;color:#fff;border-radius:.5rem;text-decoration:none}</style>`
    + `</head><body><p>Returning to GOMS…</p><a href="${href}">Open GOMS</a></body></html>`
}

export function registerOAuthRoutes(app: FastifyInstance, deps: OAuthDeps): void {
  // AUTH_PROVIDER=firebase (the default) must be a true no-op: register nothing, so Fastify's own 404 applies (no content-type
  // parsing, no per-route rate limit, no custom 404 body). AUTH_PROVIDER is read once, at app boot.
  if (!oauthEnabled()) return

  // Tighter than the global limiter: these are the only unauthenticated, state-creating endpoints.
  const limited = { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } }
  // The three POST bodies are tiny JSON ({code, client} / {refreshToken}); the app-wide 8 MB limit is for the admin import, not for these.
  const postRoute = { ...limited, bodyLimit: 4096 }

  /** Runs `fn` only when OAuth is switched on. Misconfiguration becomes a generic 503 that never names a value. ANY other failure
   *  (database down, missing table, a bug) becomes a generic 500 and one reason-only log line: Fastify has no `logger` here, so its own
   *  error path would send `error.message` (a SQL error, a private IP) to the browser and leave nothing in the logs.
   *  A JSON 500 is used on every route, the callback included: a redirect with `auth_error=google` is the convention for failures
   *  Google itself reports (bad code, token, domain), not for our own faults, and our other server-side fault (503 above) is JSON too. */
  const guarded = (route: string, fn: (req: any, reply: FastifyReply) => Promise<unknown>) => async (req: any, reply: FastifyReply) => {
    if (!oauthEnabled()) return notFound(reply) // second layer: AUTH_PROVIDER changed after boot (routes were registered)
    noStore(reply)
    try {
      return await fn(req, reply)
    } catch (e) {
      if (e instanceof OAuthConfigError) {
        console.error(JSON.stringify({ event: 'oauth.misconfigured', message: e.message })) // names the missing variables, never values
        return reply.code(503).send({ error: 'Sign-in is temporarily unavailable.' })
      }
      // The error's class name and its short machine code (e.g. `Error` / `ECONNREFUSED`, `error` / `42P01`) only: never the message,
      // stack, query text, parameters or anything from the request.
      const { name, code } = (e ?? {}) as { name?: unknown; code?: unknown }
      console.error(JSON.stringify({ event: 'oauth.error', route, name: safeLabel(name) ?? 'unknown', code: safeLabel(code) }))
      return reply.code(500).send({ error: 'Sign-in is temporarily unavailable.' })
    }
  }

  function fail(reply: FastifyReply, client: ClientKind, reason: Reason) {
    console.warn(JSON.stringify({ event: 'oauth.fail', reason })) // the reason code only: never a code, token, email, state or Google text
    if (client === 'app') return reply.code(200).type('text/html; charset=utf-8').send(appPage(appScheme(), `error=${reason}`))
    return reply.code(302).header('Location', webRedirectUrl(oauthConfig().webOrigin, '/', { auth_error: reason })).send()
  }

  app.get('/api/oauth/google/start', limited, guarded('start', async (req, reply) => {
    const client = parseClient(req.query?.client)
    if (!client) return reply.code(400).send({ error: 'invalid_request' })
    oauthConfig() // fail fast with a 503 before any state is stored
    const flow = await createFlow(client, safeReturnTo(req.query?.return_to))
    return reply.code(302).header('Location', buildAuthUrl(flow)).send()
  }))

  app.get('/api/oauth/google/callback', limited, guarded('callback', async (req, reply) => {
    const flow = await consumeFlow(req.query?.state)
    if (!flow) return fail(reply, 'web', 'state') // unknown, replayed or expired; we cannot know which client it was
    if (flow.client === 'app') appScheme() // validate the deployment's scheme BEFORE anything is issued (throws -> generic 503)
    if (typeof req.query?.error === 'string') return fail(reply, flow.client, 'denied')
    const code = req.query?.code
    if (typeof code !== 'string' || code.length === 0 || code.length > 2048) return fail(reply, flow.client, 'google')

    let claims
    try {
      const idToken = await deps.google.exchangeCode({ code, verifier: flow.verifier })
      claims = await deps.google.verifyIdToken(idToken, flow.nonce)
    } catch (e) {
      return fail(reply, flow.client, reasonFor(e))
    }
    // Only now, after every Google check, does anything exist: a one-time code. No session or token yet.
    const exchange = await createExchangeCode({ uid: `g:${claims.sub}`, email: claims.email, familyId: randomUUID(), client: flow.client })
    if (flow.client === 'app') return reply.code(200).type('text/html; charset=utf-8').send(appPage(appScheme(), `code=${exchange}`))
    return reply.code(302).header('Location', webRedirectUrl(oauthConfig().webOrigin, flow.returnTo, { auth_code: exchange })).send()
  }))

  app.post('/api/oauth/exchange', postRoute, guarded('exchange', async (req, reply) => {
    sessionKey() // a misconfigured signing key must answer 503 BEFORE the code is burned or a session row is written
    const { code, client } = (req.body ?? {}) as { code?: unknown; client?: unknown }
    if (typeof code !== 'string' || !parseClient(client)) return reply.code(400).send({ error: 'invalid_request' })
    const identity = await redeemExchangeCode(code, client)
    if (!identity) return reply.code(401).send({ error: 'invalid_code' })
    const { refreshToken } = await startSession({ ...identity, userAgent: req.headers['user-agent'] })
    const { token, expiresIn } = await signAccessToken(identity)
    return reply.code(200).send({ accessToken: token, refreshToken, expiresIn })
  }))

  app.post('/api/oauth/refresh', postRoute, guarded('refresh', async (req, reply) => {
    sessionKey() // BEFORE the rotation commits: otherwise the client keeps the replaced token and its next refresh looks like reuse
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: unknown }
    if (typeof refreshToken !== 'string') return reply.code(400).send({ error: 'invalid_request' })
    try {
      const next = await rotateRefreshToken(refreshToken, req.headers['user-agent'])
      const { token, expiresIn } = await signAccessToken(next)
      return reply.code(200).send({ accessToken: token, refreshToken: next.refreshToken, expiresIn })
    } catch (e) {
      if (e instanceof SessionError) return reply.code(401).send({ error: 'session_expired' }) // same body for invalid / reuse / not_amnex
      throw e
    }
  }))

  app.post('/api/oauth/logout', postRoute, guarded('logout', async (req, reply) => {
    await revokeFamilyByRefreshToken(((req.body ?? {}) as { refreshToken?: unknown }).refreshToken)
    return reply.code(204).send()
  }))
}

import type { FastifyInstance } from 'fastify'
import { PassThrough } from 'node:stream'
import { TRPCError } from '@trpc/server'
import { isAmnexAccount, verifyIdentity } from '../auth/identity.js'
import { productionSecurity } from '../security/config.js'
import { subscribe } from '../live/changeFeed.js'

/** Comment line every 25 s so idle proxies keep the stream open. */
export const HEARTBEAT_MS = 25_000
/** Every stream ends within 50 s (and right after its one change), and the browser reconnects at once. That keeps it
 *  under Firebase Hosting's 60 s limit for Cloud Run rewrites, still delivers promptly through a proxy that buffers
 *  until the response ends, and re-checks the caller's identity at least every 50 s. */
export const STREAM_LIFETIME_MS = 50_000

/** Same identity rule as the API itself: whenever the API authenticates anyone, a stream needs a verified
 *  @amnex.com identity, sent as the usual `Authorization: Bearer` header (the client streams with fetch, not
 *  EventSource, so no credential ever goes in the URL). */
async function authorize(authHeader: string | undefined): Promise<void> {
  const enforced = productionSecurity() || process.env.AUTH_ENFORCEMENT_ENABLED === 'true' || process.env.READ_AUTH_ENFORCEMENT_ENABLED === 'true'
  if (!enforced) return
  const user = await verifyIdentity(authHeader)
  if (!isAmnexAccount(user.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
}

/** `GET /api/events`: Server-Sent Events that only say "something changed" — `data: change` — then end. */
export function registerLiveEventsRoutes(app: FastifyInstance) {
  app.get('/api/events', { config: { rateLimit: { max: 600, timeWindow: '5 minutes' } } }, async (req, reply) => {
    try {
      await authorize(req.headers.authorization)
    } catch (error) {
      const status = error instanceof TRPCError ? (error.code === 'FORBIDDEN' ? 403 : 401) : 503
      return reply.code(status).send()
    }

    const stream = new PassThrough()
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let lifetime: ReturnType<typeof setTimeout> | undefined
    const close = () => {
      unsubscribe?.()
      clearInterval(heartbeat)
      clearTimeout(lifetime)
      if (!stream.writableEnded) stream.end()
    }
    const unsubscribe = subscribe(() => {
      stream.write('data: change\n\n')
      close()
    })
    if (!unsubscribe) return reply.code(503).header('Retry-After', '30').send()

    heartbeat = setInterval(() => stream.write(': ping\n\n'), HEARTBEAT_MS)
    lifetime = setTimeout(close, STREAM_LIFETIME_MS)
    reply.raw.on('close', close)
    // The server-wide 10 s idle socket timeout (connectionTimeout) would cut the stream between heartbeats.
    // (Optional call: Fastify's inject() mock socket has no setTimeout.)
    req.raw.socket.setTimeout?.(0)
    stream.write(': connected\n\n')
    return reply
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('X-Accel-Buffering', 'no')
      .send(stream)
  })
}

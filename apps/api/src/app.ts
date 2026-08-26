import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import type { TRPCError } from '@trpc/server'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './index.js'

export interface BuildAppOptions {
  // Override for tests only — production always gets the defaults below.
  rateLimit?: { max: number; timeWindow: string | number }
}

// Explicit allow-list only — never `origin: true`/`*`, since every procedure
// here is a `publicProcedure` with no auth check of its own (see the
// 2026-08-26 cutover readiness report §3.1/§4). `http://localhost:5173` is
// Vite's default dev-server origin, covering local opt-in remote-mode testing
// (VITE_API_BASE_URL set via an untracked .env.local — never the default).
// CORS_ALLOWED_ORIGINS adds real deployed frontend origins (comma-separated)
// once frontend hosting exists, without a code change or redeploy of this list.
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173']

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  // Fastify's find-my-way router defaults maxParamLength to 100 characters.
  // tRPC's fastify adapter matches the batched procedure-name list (e.g.
  // "hierarchy.listStates,hierarchy.listOrgRoots,...") as a single route param,
  // and httpBatchLink freely coalesces many same-tick queries into one request
  // — trivially over 100 chars on a real page. Discovered live during the
  // 2026-08-26 dev cutover browser test: the resulting 414 has no CORS headers
  // at all (rejected before the CORS hook runs), which Chrome then reports as
  // a generic "blocked by CORS policy" console error — a red herring for what
  // is actually a route-param length limit, not an origin problem.
  // Default Fastify bodyLimit is 1MB — comfortably enough for every existing
  // procedure's small JSON payloads, but not for a multi-thousand-row admin
  // import request. Raised app-wide (simplest single change) rather than
  // per-route, since tRPC's fastify adapter registers one plugin for the
  // whole /api/trpc/* prefix. 8MB comfortably covers MAX_IMPORT_ROWS (5,000)
  // rows of the heaviest domain (SKUs, ~25 columns) while still bounding
  // worst-case per-request memory.
  const app = Fastify({ routerOptions: { maxParamLength: 2000 }, bodyLimit: 8 * 1024 * 1024 })

  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const allowedOrigins = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins])]

  await app.register(cors, { origin: allowedOrigins })

  // Global, per-IP, Fastify-level limiter — no Cloud Armor/load balancer
  // (see the 2026-08-26 Stage B production-readiness plan §2). Registered
  // before the tRPC plugin so it runs on Fastify's onRequest hook, once per
  // *HTTP request* — this is what makes it batch-safe: tRPC's httpBatchLink
  // coalesces many procedure calls into one HTTP request (the same mechanism
  // behind the maxParamLength incident above), and the rate limiter has no
  // visibility into how many procedures a request's body contains, so a
  // 6-7-procedure Home-page batch still only ever costs 1 request against
  // the limit, never 6-7.
  await app.register(rateLimit, {
    global: true,
    max: opts.rateLimit?.max ?? 300,
    timeWindow: opts.rateLimit?.timeWindow ?? '5 minutes',
  })

  app.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      // Sanitized for the client by trpc.ts's errorFormatter — logged here
      // in full (including the raw pg error) so an on-call engineer can
      // still diagnose the real cause from server logs.
      onError({ path, error }: { path?: string; error: TRPCError }) {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          app.log.error({ path, err: error.cause ?? error }, 'unhandled tRPC error')
        }
      },
    },
  })

  return app
}

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './index.js'

// Fastify's find-my-way router defaults maxParamLength to 100 characters.
// tRPC's fastify adapter matches the batched procedure-name list (e.g.
// "hierarchy.listStates,hierarchy.listOrgRoots,...") as a single route param,
// and httpBatchLink freely coalesces many same-tick queries into one request
// — trivially over 100 chars on a real page. Discovered live during the
// 2026-08-26 dev cutover browser test: the resulting 414 has no CORS headers
// at all (rejected before the CORS hook runs), which Chrome then reports as
// a generic "blocked by CORS policy" console error — a red herring for what
// is actually a route-param length limit, not an origin problem.
const app = Fastify({ routerOptions: { maxParamLength: 2000 } })

// Explicit allow-list only — never `origin: true`/`*`, since every procedure
// here is a `publicProcedure` with no auth check of its own (see the
// 2026-08-26 cutover readiness report §3.1/§4). `http://localhost:5173` is
// Vite's default dev-server origin, covering local opt-in remote-mode testing
// (VITE_API_BASE_URL set via an untracked .env.local — never the default).
// CORS_ALLOWED_ORIGINS adds real deployed frontend origins (comma-separated)
// once frontend hosting exists, without a code change or redeploy of this list.
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173']
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const allowedOrigins = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins])]

await app.register(cors, { origin: allowedOrigins })
app.register(fastifyTRPCPlugin, { prefix: '/api/trpc', trpcOptions: { router: appRouter } })
app.listen({ port: Number(process.env.PORT) || 8080, host: '0.0.0.0' })

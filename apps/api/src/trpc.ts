import { initTRPC, TRPCError } from '@trpc/server'

export const t = initTRPC.create({
  // Every deliberate TRPCError a router throws (BAD_REQUEST/NOT_FOUND/
  // CONFLICT with a purpose-written message, e.g. "Code already used by
  // another row") passes through unchanged. INTERNAL_SERVER_ERROR only ever
  // reaches here via tRPC's own auto-wrapping of an uncaught throw — in this
  // codebase that's always a raw `pg` driver error escaping one of the
  // routers' `catch (e) { await client.query('ROLLBACK'); throw e }` blocks
  // (no router deliberately throws INTERNAL_SERVER_ERROR itself, confirmed
  // by grep). That raw message is the database driver's own text and can
  // name internal hosts, constraints, or column names, so it must not reach
  // the client — the real error is still logged server-side via the fastify
  // plugin's onError hook (apps/api/src/app.ts) before being sanitized here.
  errorFormatter({ shape, error }) {
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      return { ...shape, message: 'Internal server error' }
    }
    return shape
  },
})
export const router = t.router
export const publicProcedure = t.procedure

/** Every adminImport procedure chains through this. Not auth — that doesn't
 *  exist yet (Stage B §1, paused on Amnex IT) — a deliberately blunt
 *  environment gate so the Admin Data Import feature can be built and
 *  tested in goms-dev without ever being reachable in goms-prod until a
 *  real adminProcedure wraps it (see the admin-data-import design doc's
 *  "Production safety gate" section). goms-prod's Terraform never sets this
 *  var. Every procedure stays in the static AppRouter type regardless of
 *  the env var's value — only the runtime call 404s when it's unset. */
export const adminImportProcedure = publicProcedure.use(({ next }) => {
  if (process.env.ADMIN_IMPORT_ENABLED !== 'true') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' })
  }
  return next()
})

import { initTRPC, TRPCError } from '@trpc/server'
import { verifyAdminImportToken } from './auth/verifyAdminImportToken.js'

/** authHeader is the raw incoming `Authorization` header, forwarded as-is by
 *  app.ts's createContext. Every router except adminImport ignores it —
 *  DRIFT-001's broader "everything is publicProcedure" posture is deliberately
 *  unchanged (see the admin-import auth plan's Global Constraints). */
export interface Context {
  authHeader?: string
}

export const t = initTRPC.context<Context>().create({
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

/** Every adminImport procedure chains through this. Two independent gates,
 *  both required: the ADMIN_IMPORT_ENABLED environment flag (unchanged from
 *  the original feature-flag-only version of this gate — goms-prod's
 *  Terraform never sets this var), and now a verified, allow-listed
 *  Firebase identity (2026-09-01, closing Gate 1 of the 2026-08-27
 *  enablement plan for this feature specifically — see
 *  docs/superpowers/analysis/2026-08-31-goms-prod-admin-import-deployment-
 *  safety-report.md §7 for the design this implements). Every procedure
 *  stays in the static AppRouter type regardless of either check's outcome
 *  — only the runtime call fails when a check doesn't pass. */
export const adminImportProcedure = publicProcedure
  .use(({ next }) => {
    if (process.env.ADMIN_IMPORT_ENABLED !== 'true') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' })
    }
    return next()
  })
  .use(async ({ ctx, next }) => {
    const user = await verifyAdminImportToken(ctx.authHeader)
    return next({ ctx: { ...ctx, user } })
  })

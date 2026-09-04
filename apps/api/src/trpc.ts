import { initTRPC, TRPCError } from '@trpc/server'
import { verifyAdminImportToken } from './auth/verifyAdminImportToken.js'
import { verifyFirebaseToken, isAllowListed, isAmnexAccount, type AuthenticatedUser } from './auth/identity.js'

export interface Context {
  authHeader?: string
  user?: AuthenticatedUser
}

export const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      return { ...shape, message: 'Internal server error' }
    }
    return shape
  },
})
export const router = t.router
export const publicProcedure = t.procedure

/** Incident kill switch (decision doc §5) — checked unconditionally, ahead
 *  of every other gate, regardless of whether AUTH_ENFORCEMENT_ENABLED
 *  itself is on. A plain env var, so it toggles via Cloud Run config +
 *  redeploy, no image rebuild. */
function assertNotReadOnly() {
  if (process.env.EMERGENCY_READ_ONLY === 'true') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'GOMS is temporarily in read-only mode. Writes are disabled.' })
  }
}

function authEnforced(): boolean {
  return process.env.AUTH_ENFORCEMENT_ENABLED === 'true'
}

/** Ordinary authenticated-user boundary (decision doc §1/§2): every mutation
 *  across every business router chains through this; reads stay on
 *  publicProcedure, unchanged. Off (the default), this behaves exactly like
 *  publicProcedure always has — deploying this code with the flag off is a
 *  deliberate no-op release. On, every call must present a verified,
 *  @amnex.com Google identity. */
export const protectedProcedure = publicProcedure
  .use(({ type, next }) => {
    // Scoped to mutations only — EMERGENCY_READ_ONLY must not block reads
    // (decision doc §5: "reads keep working"). Every existing usage of
    // protectedProcedure happens to be a mutation today, which made this
    // "accidentally safe" before this scoping was added.
    if (type === 'mutation') assertNotReadOnly()
    return next()
  })
  .use(async ({ ctx, next }) => {
    if (!authEnforced()) {
      return next({ ctx })
    }
    const user = await verifyFirebaseToken(ctx.authHeader)
    if (!isAmnexAccount(user.email)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
    }
    return next({ ctx: { ...ctx, user } })
  })

/** Explicit admin allow-list (decision doc §3), generalized from the Admin
 *  Data Import pattern rather than copy-pasted: ADMIN_ALLOWED_EMAILS is a
 *  separate roster from ADMIN_IMPORT_ALLOWED_EMAILS, so granting one admin
 *  surface never implicitly grants another. Inherits protectedProcedure's
 *  read-only/enforcement gates, then adds one more check — also a no-op
 *  when enforcement is off, for the same reason. Not applied to any router
 *  yet; it exists as ready infrastructure for a future admin-gated surface
 *  (decision doc §3). */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!authEnforced()) {
    return next({ ctx })
  }
  if (!ctx.user || !isAllowListed(ctx.user.email, process.env.ADMIN_ALLOWED_EMAILS)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account is not authorized for this administrative action.' })
  }
  return next({ ctx })
})

/** Unchanged from before, plus the same EMERGENCY_READ_ONLY gate every other
 *  mutation now has — Admin Data Import's own mutations (session.commit,
 *  commitGeographyLoad) must also stop during an incident. */
export const adminImportProcedure = publicProcedure
  .use(({ type, next }) => {
    // Scoped to mutations only (same reasoning as protectedProcedure above)
    // — adminImportProcedure gates both reads (session.history, history,
    // listDomains) and writes (session.commit, commitGeographyLoad), so an
    // unconditional check here would incorrectly block Admin Data Import's
    // reads during an EMERGENCY_READ_ONLY incident too.
    if (type === 'mutation') assertNotReadOnly()
    if (process.env.ADMIN_IMPORT_ENABLED !== 'true') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' })
    }
    return next()
  })
  .use(async ({ ctx, next }) => {
    const user = await verifyAdminImportToken(ctx.authHeader)
    return next({ ctx: { ...ctx, user } })
  })

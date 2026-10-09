import { initTRPC, TRPCError } from '@trpc/server'
import { verifyAdminImportToken } from './auth/verifyAdminImportToken.js'
import { verifyIdentity, isAllowListed, isAmnexAccount, type AuthenticatedUser } from './auth/identity.js'
import { rbacMode } from './auth/rbac/mode.js'
import { evaluateCall } from './auth/rbac/guard.js'
import { RbacDenial } from './auth/rbac/denial.js'

export interface Context {
  authHeader?: string
  user?: AuthenticatedUser
}

/** Exported for testing. An RBAC denial is flagged (`data.rbacDenied`) so the client can show a normal "no
 *  permission" message instead of the "sign in with your @amnex.com account" dialog every FORBIDDEN used to trigger. */
export function formatError({ shape, error }: { shape: any; error: TRPCError }) {
  if (error.code === 'INTERNAL_SERVER_ERROR') {
    return { ...shape, message: 'Internal server error' }
  }
  if (error.cause instanceof RbacDenial) {
    return { ...shape, data: { ...shape.data, rbacDenied: true } }
  }
  return shape
}

export const t = initTRPC.context<Context>().create({ errorFormatter: formatError })
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

/** RBAC (docs/superpowers/specs/2026-10-06-rbac-design.md). `off` (the default, and always when auth is not
 *  enforced) is an exact no-op. Otherwise looks the procedure up in PROCEDURE_POLICY and evaluates every one of its
 *  requirements; `shadow` only logs a denial, `enforce` throws FORBIDDEN. The entry's `mask` post-processes the
 *  response for this caller. */
const rbacGate = t.middleware(async ({ ctx, path, getRawInput, next }) => {
  const mode = rbacMode()
  if (mode === 'off') return next()
  const { entry, user } = await evaluateCall({ mode, path, rawInput: await getRawInput(), ctx })
  const result = await next()
  // Masks change what a caller sees, so — like a denial — they are applied only at `enforce`; `shadow` changes nothing.
  if (mode === 'enforce' && result.ok && entry?.mask && user) return { ...result, data: entry.mask(result.data, user) }
  return result
})

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
    const user = await verifyIdentity(ctx.authHeader)
    if (!isAmnexAccount(user.email)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
    }
    return next({ ctx: { ...ctx, user } })
  })
  .use(rbacGate)

function readAuthEnforced(): boolean {
  return process.env.READ_AUTH_ENFORCEMENT_ENABLED === 'true'
}

/** Staged read-protection boundary (2026-09-15 public-read security audit,
 *  finding: every query in every business router was `publicProcedure`).
 *  Reuses the exact same authorization check as protectedProcedure —
 *  verifyIdentity + isAmnexAccount, no new rule — but behind its own
 *  independent flag rather than AUTH_ENFORCEMENT_ENABLED. That flag is
 *  already "true" in goms-prod today (for mutations), so a read wired
 *  through protectedProcedure itself would start enforcing the moment this
 *  code deploys, with no separate opportunity to stage/verify on goms-dev
 *  first. READ_AUTH_ENFORCEMENT_ENABLED defaults unset/false, so every read
 *  converted to this procedure keeps behaving exactly like publicProcedure
 *  — a deliberate no-op — until this flag is explicitly turned on,
 *  per-environment, same rollout discipline AUTH_ENFORCEMENT_ENABLED itself
 *  used. No EMERGENCY_READ_ONLY check here: that kill switch is mutation-only
 *  by design (decision doc §5, "reads keep working") and stays that way
 *  regardless of which procedure tier a read is on. */
export const protectedReadProcedure = publicProcedure
  .use(async ({ ctx, next }) => {
    if (!readAuthEnforced()) {
      return next({ ctx })
    }
    const user = await verifyIdentity(ctx.authHeader)
    if (!isAmnexAccount(user.email)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
    }
    return next({ ctx: { ...ctx, user } })
  })
  .use(rbacGate)

/** For the 17 reads that were `publicProcedure` (hierarchy + commercial masters/BOM/edition features). With
 *  RBAC_MODE=off it is exactly `publicProcedure`; in `shadow` it logs; in `enforce` it requires a verified
 *  @amnex.com login plus the per-procedure read permission (RBAC spec §8). */
export const rbacReadProcedure = publicProcedure.use(rbacGate)

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

/** For the access API (`access.*`). Overrides created while RBAC is `off` become live the moment it is enforced, so
 *  this is gated regardless of RBAC_MODE: in `off` mode only ADMIN_ALLOWED_EMAILS members (the System Admins) may use it; in
 *  shadow/enforce the registry's `admin.access` requirement applies (IT, or System Admin). */
export const accessProcedure = protectedProcedure.use(async ({ ctx, path, getRawInput, next }) => {
  const mode = rbacMode()
  if (mode === 'off' && authEnforced()) {
    if (!ctx.user || !isAllowListed(ctx.user.email, process.env.ADMIN_ALLOWED_EMAILS)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account is not authorized to manage access.' })
    }
  }
  // `shadow` only logs for every other procedure, but an override written during shadow becomes a live role the moment
  // RBAC is enforced — so here the decision is applied in shadow too (spec §3.3).
  if (mode === 'shadow') await evaluateCall({ mode: 'enforce', path, rawInput: await getRawInput(), ctx })
  return next()
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

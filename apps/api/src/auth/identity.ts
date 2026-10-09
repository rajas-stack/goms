import { TRPCError } from '@trpc/server'
import { getFirebaseAuth } from './firebaseAdmin.js'
import { AccessTokenError, isGomsToken, verifyAccessToken } from './oauth/accessToken.js'
import { OAuthConfigError, authProvider, firebaseAccepted, gomsAccepted } from './oauth/config.js'

export interface AuthenticatedUser {
  uid: string
  email: string
}

/** Decodes and validates a Firebase ID token from an incoming Authorization
 *  header. Shared by every procedure tier (protectedProcedure, adminProcedure,
 *  adminImportProcedure): authentication (is this a real, current Google
 *  sign-in?) is one concern, checked once here; authorization (what is this
 *  person allowed to do?) is layered on top by each caller. */
export async function verifyFirebaseToken(authHeader: string | undefined): Promise<AuthenticatedUser> {
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  if (!idToken) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
  }

  let decoded: { uid: string; email?: string; email_verified?: boolean }
  try {
    decoded = await getFirebaseAuth().verifyIdToken(idToken)
  } catch {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
  }

  if (!decoded.email || !decoded.email_verified) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in with a verified Google account.' })
  }

  return { uid: decoded.uid, email: decoded.email }
}

/** The ONE place identity is established (RBAC spec §3.4 / OAuth spec §4.1). Returns the same `{uid, email}` whichever kind of
 *  token carried it, so authorisation downstream (the @amnex.com gate, RBAC roles, allow-lists, Admin Data Import) cannot tell.
 *    firebase: Firebase only (today's behaviour).   both: GOMS token or Firebase token.   oauth: GOMS only.
 *  A GOMS-looking token is verified as GOMS and never falls through to Firebase. */
export async function verifyIdentity(authHeader: string | undefined): Promise<AuthenticatedUser> {
  if (authProvider() === 'firebase') return verifyFirebaseToken(authHeader)
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  if (!token) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
  if (gomsAccepted() && isGomsToken(token)) {
    try {
      const c = await verifyAccessToken(token)
      return { uid: c.uid, email: c.email }
    } catch (e) {
      if (e instanceof AccessTokenError) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
      if (e instanceof OAuthConfigError) {
        // Misconfiguration (e.g. AUTH_SESSION_SECRET missing/short), not a bad token: tell the operator, with no values, and keep the
        // user-facing answer identical to any other rejected session.
        console.error(JSON.stringify({ event: 'auth.config_error' }))
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
      }
      throw e
    }
  }
  if (firebaseAccepted()) return verifyFirebaseToken(authHeader)
  throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
}

export function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}

export function isAllowListed(email: string, raw: string | undefined): boolean {
  return parseAllowList(raw).includes(email.toLowerCase())
}

/** The ordinary-user authorization boundary (decision doc §2): any verified
 *  Google account on Amnex's own Workspace domain. A suffix check, not an
 *  allow-list — it covers every current and future Amnex employee with zero
 *  maintenance, unlike the explicit admin allow-lists this module also
 *  supports via isAllowListed. */
export function isAmnexAccount(email: string): boolean {
  return email.toLowerCase().endsWith('@amnex.com')
}

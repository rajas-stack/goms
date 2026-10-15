import { TRPCError } from '@trpc/server'
import { AccessTokenError, isGomsToken, verifyAccessToken } from './oauth/accessToken.js'
import { OAuthConfigError } from './oauth/config.js'

export interface AuthenticatedUser {
  uid: string
  email: string
}

const SESSION_EXPIRED = 'Your session has expired. Please sign in again.'

/** The ONE place identity is established (RBAC spec §3.4 / OAuth spec §4.1). Verifies the GOMS access token issued after a Google
 *  sign-in (its email was verified by Google and checked against the Amnex domain when the session started) and returns `{uid, email}`.
 *  Shared by every procedure tier (protectedProcedure, adminProcedure, adminImportProcedure): authentication (is this a real, current
 *  sign-in?) is one concern, checked once here; authorization (what is this person allowed to do?) is layered on top by each caller. */
export async function verifyIdentity(authHeader: string | undefined): Promise<AuthenticatedUser> {
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  if (!token) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
  if (!isGomsToken(token)) throw new TRPCError({ code: 'UNAUTHORIZED', message: SESSION_EXPIRED })
  try {
    const c = await verifyAccessToken(token)
    return { uid: c.uid, email: c.email }
  } catch (e) {
    if (e instanceof AccessTokenError) throw new TRPCError({ code: 'UNAUTHORIZED', message: SESSION_EXPIRED })
    if (e instanceof OAuthConfigError) {
      // Misconfiguration (e.g. AUTH_SESSION_SECRET missing/short), not a bad token: tell the operator, with no values, and keep the
      // user-facing answer identical to any other rejected session.
      console.error(JSON.stringify({ event: 'auth.config_error' }))
      throw new TRPCError({ code: 'UNAUTHORIZED', message: SESSION_EXPIRED })
    }
    throw e
  }
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

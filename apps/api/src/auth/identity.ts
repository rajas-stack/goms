import { TRPCError } from '@trpc/server'
import { getFirebaseAuth } from './firebaseAdmin.js'
import { maxSessionAgeSeconds, productionSecurity } from '../security/config.js'
import { AccessTokenError, isGomsToken, verifyAccessToken } from './oauth/accessToken.js'
import { OAuthConfigError, authProvider, firebaseAccepted, gomsAccepted } from './oauth/config.js'

export interface AuthenticatedUser {
  uid: string
  email: string
  authTime?: number
}

/** An authenticated user plus, when the VERIFIED token proves it, their Google subject id (`sub`): the one identifier that is stable across
 *  Firebase and direct Google OAuth and is never reassigned (unlike an email address). Absent = nothing proved, so nothing may be linked. */
export interface LinkedIdentity extends AuthenticatedUser {
  googleSub?: string
}

/** Firebase states the Google subject id of a Google sign-in in its own verified claim `firebase.identities['google.com']`. */
function googleSubFromFirebase(decoded: { firebase?: { identities?: Record<string, unknown> } }): string | undefined {
  const ids = decoded.firebase?.identities?.['google.com']
  const sub = Array.isArray(ids) ? ids[0] : undefined
  return typeof sub === 'string' && sub !== '' ? sub : undefined
}
/** A GOMS token's uid is `g:<google sub>` (set by the OAuth callback after Google verified the ID token). */
function googleSubFromGomsUid(uid: string): string | undefined {
  return uid.startsWith('g:') && uid.length > 2 ? uid.slice(2) : undefined
}

/** Decodes and validates a Firebase ID token from an incoming Authorization
 *  header. Shared by every procedure tier (protectedProcedure, adminProcedure,
 *  adminImportProcedure): authentication (is this a real, current Google
 *  sign-in?) is one concern, checked once here; authorization (what is this
 *  person allowed to do?) is layered on top by each caller. */
export async function verifyFirebaseToken(authHeader: string | undefined): Promise<AuthenticatedUser> {
  const { googleSub: _unused, ...user } = await verifyFirebaseIdentity(authHeader)
  return user
}

async function verifyFirebaseIdentity(authHeader: string | undefined): Promise<LinkedIdentity> {
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  if (!idToken) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
  }

  let decoded: { uid: string; email?: string; email_verified?: boolean; auth_time?: number; firebase?: { sign_in_provider?: string; identities?: Record<string, unknown> } }
  try {
    decoded = await getFirebaseAuth().verifyIdToken(idToken, productionSecurity())
  } catch {
    console.warn(JSON.stringify({ event: 'security.authentication_failed' }))
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
  }

  if (!decoded.email || !decoded.email_verified) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in with a verified Google account.' })
  }
  if (productionSecurity() && decoded.firebase?.sign_in_provider !== 'google.com') throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in with your Google account.' })
  if (productionSecurity() && (!decoded.auth_time || Date.now() / 1000 - decoded.auth_time > maxSessionAgeSeconds() || decoded.auth_time > Date.now() / 1000 + 300)) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in again to renew your session.' })

  return { uid: decoded.uid, email: decoded.email, ...(productionSecurity() ? { authTime: decoded.auth_time } : {}), googleSub: googleSubFromFirebase(decoded) }
}

/** The ONE place identity is established (RBAC spec §3.4 / OAuth spec §4.1). Returns the same `{uid, email}` whichever kind of
 *  token carried it, so authorisation downstream (the @amnex.com gate, RBAC roles, allow-lists, Admin Data Import) cannot tell.
 *    firebase: Firebase only (today's behaviour).   both: GOMS token or Firebase token.   oauth: GOMS only.
 *  A GOMS-looking token is verified as GOMS and never falls through to Firebase. */
export async function verifyIdentity(authHeader: string | undefined): Promise<AuthenticatedUser> {
  const { googleSub: _unused, ...user } = await verifyLinkedIdentity(authHeader)
  return user
}

/** Same authentication as `verifyIdentity` (it IS the implementation), additionally returning the Google subject id the token proves, if any. */
export async function verifyLinkedIdentity(authHeader: string | undefined): Promise<LinkedIdentity> {
  if (authProvider() === 'firebase') return verifyFirebaseIdentity(authHeader)
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  if (!token) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
  if (gomsAccepted() && isGomsToken(token)) {
    try {
      const c = await verifyAccessToken(token)
      return { uid: c.uid, email: c.email, googleSub: googleSubFromGomsUid(c.uid) }
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
  if (firebaseAccepted()) {
    const identity = await verifyFirebaseIdentity(authHeader)
    // Reached only in `both` (`firebase` returned above, `oauth` does not accept Firebase tokens). While the API accepts either token
    // kind this is the evidence of who still sends Firebase tokens (the web build, an old Android build, a stale tab), and so of what the
    // OAuth-only switch would cut off. `firebase` mode logs nothing: every request is a Firebase request, so there is nothing to learn.
    // One event per verification (a request can verify more than once), so read it as zero / non-zero and as a trend, not as a head
    // count. It carries no token, uid, email, cookie or query value.
    console.info(JSON.stringify({ event: 'auth.firebase_token_accepted' }))
    return identity
  }
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

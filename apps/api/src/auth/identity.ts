import { TRPCError } from '@trpc/server'
import { getFirebaseAuth } from './firebaseAdmin.js'
import { productionSecurity } from '../security/config.js'

export interface AuthenticatedUser {
  uid: string
  email: string
  authTime?: number
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

  let decoded: { uid: string; email?: string; email_verified?: boolean; auth_time?: number; firebase?: { sign_in_provider?: string } }
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
  if (productionSecurity() && (!decoded.auth_time || Date.now() / 1000 - decoded.auth_time > 43200 || decoded.auth_time > Date.now() / 1000 + 300)) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in again to renew your session.' })

  return { uid: decoded.uid, email: decoded.email, ...(productionSecurity() ? { authTime: decoded.auth_time } : {}) }
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

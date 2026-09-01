import { TRPCError } from '@trpc/server'
import { getFirebaseAuth } from './firebaseAdmin.js'

export interface AdminImportUser {
  uid: string
  email: string
}

function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}

/** Both the authentication (is this a real, current Google sign-in?) and the
 *  authorization (is this specific person allowed to use Admin Data Import?)
 *  checks live here, deliberately kept together: adminImportProcedure has
 *  exactly one identity gate to chain, and every caller of this function
 *  gets both checks for free, in the right order, every time. */
export async function verifyAdminImportToken(authHeader: string | undefined): Promise<AdminImportUser> {
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  if (!idToken) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in with your Google account to use Admin Data Import.' })
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

  const allowList = parseAllowList(process.env.ADMIN_IMPORT_ALLOWED_EMAILS)
  if (!allowList.includes(decoded.email.toLowerCase())) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account is not authorized for Admin Data Import.' })
  }

  return { uid: decoded.uid, email: decoded.email }
}

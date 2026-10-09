import { TRPCError } from '@trpc/server'
import { verifyIdentity, isAllowListed, type AuthenticatedUser } from './identity.js'

export type AdminImportUser = AuthenticatedUser

/** Both the authentication (real, current Google sign-in?) and authorization
 *  (on ADMIN_IMPORT_ALLOWED_EMAILS?) checks live here, deliberately kept
 *  together — unchanged in outward behavior from before this refactor, now
 *  built on the shared verifyIdentity/isAllowListed primitives in
 *  identity.ts instead of duplicating token-decoding logic. */
export async function verifyAdminImportToken(authHeader: string | undefined): Promise<AdminImportUser> {
  const user = await verifyIdentity(authHeader)
  if (!isAllowListed(user.email, process.env.ADMIN_IMPORT_ALLOWED_EMAILS)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account is not authorized for Admin Data Import.' })
  }
  return user
}

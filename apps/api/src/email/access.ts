import { TRPCError } from '@trpc/server'
import { isAmnexAccount, verifyIdentity } from '../auth/identity.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'
import type { Context } from '../trpc.js'

/**
 * Who is connecting a Gmail mailbox.
 *
 * Reduced on purpose for this release line. The main lineage's Email Center resolves an actor with RBAC permission-tree nodes (`email`,
 * `email.*`) and record adapters that do not exist here, and importing them would change RBAC. This line therefore gates the Gmail
 * connection by verified identity alone and, as an interim, to system administrators. It can be widened later by porting those nodes;
 * it cannot be un-leaked once a mailbox credential is stored for someone who should not have one.
 */
export interface EmailActor { uid: string; email: string }
export async function emailActor(ctx: Context): Promise<EmailActor> {
  const identity = await verifyIdentity(ctx.authHeader)
  if (!isAmnexAccount(identity.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with an approved company Google Workspace account.' })
  const email = identity.email.toLowerCase()
  if (!isSystemAdminEmail(email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Connecting Gmail is limited to system administrators in this release.' })
  return { uid: identity.uid, email }
}

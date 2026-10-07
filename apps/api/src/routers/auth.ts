import type { RbacMode, Role, UserFacts } from '@goms/domain'
import { isAmnexAccount, verifyFirebaseToken } from '../auth/identity.js'
import { rbacMode } from '../auth/rbac/mode.js'
import { loadUserFacts } from '../auth/rbac/userFacts.js'
import { pool } from '../db.js'
import { TRPCError } from '@trpc/server'
import { publicProcedure, router } from '../trpc.js'

export interface MyAccess {
  mode: RbacMode
  email: string | null
  roles: Role[]
  facts: { salesPersonId: string | null; teamMemberIds: UserFacts['teamMemberIds'] } | null
}

export const authRouter = router({
  /** The caller's effective roles and roster facts, which the UI feeds to the shared evaluators. With RBAC off it
   *  reports nothing — the UI then treats everything as allowed, exactly like today. */
  me: publicProcedure.query(async ({ ctx }): Promise<MyAccess> => {
    const mode = rbacMode()
    if (mode === 'off') return { mode, email: ctx.user?.email ?? null, roles: [], facts: null }
    let verified = ctx.user
    if (!verified) {
      try {
        verified = await verifyFirebaseToken(ctx.authHeader)
      } catch (e) {
        // `shadow` changes nothing for the browser: a signed-out visitor is not prompted to sign in. At `enforce` they are.
        if (mode === 'shadow') return { mode: 'off', email: null, roles: [], facts: null }
        throw e
      }
    }
    if (!isAmnexAccount(verified.email)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
    }
    const facts = await loadUserFacts(verified.email)
    await pool.query(
      `INSERT INTO rbac_seen_users (email, role_count, last_seen_at) VALUES ($1, $2, now())
       ON CONFLICT (email) DO UPDATE SET role_count = EXCLUDED.role_count, last_seen_at = now()`,
      [facts.email, facts.roles.length],
    )
    return {
      mode, email: facts.email, roles: [...facts.roles],
      facts: { salesPersonId: facts.salesPersonId, teamMemberIds: facts.teamMemberIds },
    }
  }),
})

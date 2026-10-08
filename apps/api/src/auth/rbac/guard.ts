import { TRPCError } from '@trpc/server'
import { ownEntry, type RbacMode, type UserFacts } from '@goms/domain'
import { isAmnexAccount, verifyFirebaseToken } from '../identity.js'
import { decide } from './decide.js'
import { RbacDenial } from './denial.js'
import { PROCEDURE_POLICY } from './registry/index.js'
import type { PolicyEntry } from './registry/types.js'
import { loadUserFacts } from './userFacts.js'

export interface CallOutcome { entry: PolicyEntry | undefined; user: UserFacts | null }

function logShadow(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: 'rbac.would_deny', ...fields }))
}

/** Authorises one procedure call. In `shadow` it only logs; in `enforce` it throws. Never called when mode is `off`. */
export async function evaluateCall(args: {
  mode: Exclude<RbacMode, 'off'>
  path: string
  rawInput: unknown
  ctx: { authHeader?: string; user?: { email: string } }
}): Promise<CallOutcome> {
  const { mode, path, rawInput, ctx } = args
  const entry = ownEntry(PROCEDURE_POLICY, path)
  if (entry?.kind) return { entry, user: null }

  let email = ctx.user?.email
  if (!email) {
    // Public reads and reads with READ_AUTH off arrive here unauthenticated: resolve the caller ourselves.
    try {
      const verified = await verifyFirebaseToken(ctx.authHeader)
      if (!isAmnexAccount(verified.email)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
      }
      email = verified.email
    } catch (e) {
      if (mode === 'enforce') throw e
      logShadow({ path, email: null, module: 'identity', action: 'call', message: 'unauthenticated' })
      return { entry, user: null }
    }
  }

  const user = await loadUserFacts(email)
  const { denial } = await decide(path, rawInput, user)
  if (!denial) return { entry, user }
  if (mode === 'shadow') {
    logShadow({ path, email: user.email, module: denial.module, action: denial.action, atom: denial.atom, message: denial.message })
    return { entry, user }
  }
  throw new TRPCError({ code: 'FORBIDDEN', message: denial.message, cause: new RbacDenial(denial.message, denial) })
}

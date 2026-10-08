import { TRPCError } from '@trpc/server'
import { DenyCall, RbacDenial } from '../auth/rbac/denial.js'
import { PROCEDURE_POLICY } from '../auth/rbac/registry/index.js'
import { contextForEmail } from './authTestHelpers.js'

const PROBE = 'rbac-gate-probe'

type Callable = Record<string, any>
const reach = (caller: Callable, path: string): ((input?: unknown) => Promise<unknown>) =>
  path.split('.').reduce<any>((node, part) => node[part], caller)

/** Proves, by calling it, that each procedure runs the RBAC gate. Every checked procedure's registry entry is swapped for one
 *  whose only requirement refuses with a unique probe message; a procedure mounted on a tier WITHOUT the gate never evaluates
 *  its entry, so it does not produce that refusal and is reported. (Reading the registry alone cannot tell the two apart.)
 *  Requires AUTH_ENFORCEMENT_ENABLED=true and RBAC_MODE=enforce. */
export async function ungatedProcedures(router: { createCaller: (ctx: any) => Callable }, paths: string[]): Promise<string[]> {
  const saved = new Map(paths.map((p) => [p, PROCEDURE_POLICY[p]] as const))
  const caller = router.createCaller(contextForEmail('rbac-probe@amnex.com'))
  const ungated: string[] = []
  try {
    for (const path of paths) {
      PROCEDURE_POLICY[path] = { requirements: [() => { throw new DenyCall(PROBE) }] }
      try {
        await reach(caller, path)(undefined)
        ungated.push(path) // the handler ran to completion
      } catch (e) {
        const probed = e instanceof TRPCError && e.cause instanceof RbacDenial && e.message === PROBE
        if (!probed) ungated.push(path) // refused (or failed) for some reason other than the gate
      }
    }
  } finally {
    for (const [path, entry] of saved) {
      if (entry) PROCEDURE_POLICY[path] = entry
      else delete PROCEDURE_POLICY[path]
    }
  }
  return ungated
}

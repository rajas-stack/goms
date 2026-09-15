import { observable } from '@trpc/server/observable'
import type { TRPCLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'
import { notifyAuthRequired } from '@/lib/authPrompt'

/** Sits ahead of httpBatchLink in the main app's tRPC client
 *  (repository.ts) — the single choke point for every business-router
 *  call. Originally only a mutation could fail with UNAUTHORIZED/FORBIDDEN
 *  (apps/api/src/trpc.ts's protectedProcedure) since every read was
 *  `publicProcedure`. As of the 2026-09-15 read-protection rollout, a read
 *  can fail the same way too — behind its own independent, staged
 *  READ_AUTH_ENFORCEMENT_ENABLED flag (apps/api/src/trpc.ts's
 *  protectedReadProcedure), off by default, so this had no observable
 *  effect until that flag is explicitly turned on for an environment. This
 *  link reacts identically to either op type: whichever fails, it triggers
 *  the same global sign-in prompt instead of leaving each call site (~60
 *  mutations, plus now every protected read) to notice and handle it
 *  individually. The error itself is re-emitted unchanged, so existing
 *  per-call error handling (toasts, form validation, etc.) still runs
 *  exactly as before. */
export const authPromptLink: TRPCLink<AppRouter> = () => {
  return ({ op, next }) =>
    observable((observer) => {
      const subscription = next(op).subscribe({
        next(value) {
          observer.next(value)
        },
        error(err) {
          const code = (err as { data?: { code?: string } } | null)?.data?.code
          if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
            notifyAuthRequired(code === 'FORBIDDEN' ? 'forbidden' : 'unauthorized')
          }
          observer.error(err)
        },
        complete() {
          observer.complete()
        },
      })
      return subscription
    })
}

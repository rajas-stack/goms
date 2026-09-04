import { observable } from '@trpc/server/observable'
import type { TRPCLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'
import { notifyAuthRequired } from '@/lib/authPrompt'

/** Sits ahead of httpBatchLink in the main app's tRPC client
 *  (repository.ts) — the single choke point for every business-router
 *  call. Reads are public in this phase (decision doc §1), so only a
 *  mutation can legitimately fail with UNAUTHORIZED/FORBIDDEN
 *  (apps/api/src/trpc.ts's protectedProcedure); when one does, this
 *  triggers the global sign-in prompt instead of leaving each of the ~60
 *  mutation call sites to notice and handle it individually. The error
 *  itself is re-emitted unchanged, so existing per-call error handling
 *  (toasts, form validation, etc.) still runs exactly as before. */
export const authPromptLink: TRPCLink<AppRouter> = () => {
  return ({ op, next }) =>
    observable((observer) => {
      const subscription = next(op).subscribe({
        next(value) {
          observer.next(value)
        },
        error(err) {
          if (op.type === 'mutation') {
            const code = (err as { data?: { code?: string } } | null)?.data?.code
            if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
              notifyAuthRequired(code === 'FORBIDDEN' ? 'forbidden' : 'unauthorized')
            }
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

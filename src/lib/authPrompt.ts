export type AuthPromptReason = 'unauthorized' | 'forbidden'
type Listener = (reason: AuthPromptReason) => void

const listeners = new Set<Listener>()

export function notifyAuthRequired(reason: AuthPromptReason): void {
  listeners.forEach((listener) => listener(reason))
}

let pending: AuthPromptReason | null = null
/** For a reason raised before the dialog has mounted (e.g. a failed sign-in redirect). The first subscriber receives it. */
export function setPendingAuthReason(reason: AuthPromptReason): void { pending = reason }

export function subscribeAuthRequired(listener: Listener): () => void {
  listeners.add(listener)
  if (pending) { const r = pending; pending = null; queueMicrotask(() => listener(r)) }
  return () => listeners.delete(listener)
}

/** For a reason raised from OUTSIDE React (e.g. an Android deep link): delivered at once to the mounted dialog, or held for the next
 *  subscriber when none exists yet. setPendingAuthReason alone would leak into a later mount whenever the dialog was already listening. */
export function raiseAuthReason(reason: AuthPromptReason): void {
  if (listeners.size > 0) notifyAuthRequired(reason)
  else setPendingAuthReason(reason)
}

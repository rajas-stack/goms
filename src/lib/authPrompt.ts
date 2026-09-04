export type AuthPromptReason = 'unauthorized' | 'forbidden'
type Listener = (reason: AuthPromptReason) => void

const listeners = new Set<Listener>()

export function notifyAuthRequired(reason: AuthPromptReason): void {
  listeners.forEach((listener) => listener(reason))
}

export function subscribeAuthRequired(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

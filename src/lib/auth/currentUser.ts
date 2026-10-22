import { authApi } from './authApi'

/** The API uid of whoever is signed in right now (a Firebase uid, or `g:<google sub>` under direct Google OAuth), or null when nobody is. A
 *  plain function for code that is not a React hook; callers that key per-person browser storage fall back to their own "local" key only
 *  when this is null, exactly as they did with `auth?.currentUser?.uid`. */
export const currentAuthUid = (): string | null => authApi.currentUser()?.uid ?? null

/** Calls `onChange` when the signed-in PERSON changes after the provider has reported once: someone else signs in, or the user signs out.
 *  Ignores the provider's initial "loading" report and every re-emit of the same person (an OAuth session re-emits on each access-token refresh,
 *  about every 15 minutes), so a screen holding something sensitive clears on a real identity change without being wiped by routine refreshes.
 *  Returns the unsubscribe function. */
export function onAuthIdentityChange(onChange: () => void): () => void {
  let known = false
  let current: string | null = null
  return authApi.subscribe((user, loading) => {
    if (loading) return
    const next = user ? (user.uid ?? user.email ?? '') : null
    if (known && next !== current) onChange()
    known = true
    current = next
  })
}

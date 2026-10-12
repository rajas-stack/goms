import { authApi } from '@/lib/auth'

/** Attaches the current Firebase ID token, if any, to every request made by
 *  the main app's tRPC client (repository.ts) — the single choke point
 *  every business-router call goes through. getIdToken() transparently
 *  refreshes a token due to expire but still valid; if the user is signed
 *  out, or refresh fails (a revoked/expired session), this resolves to no
 *  Authorization header, and the request proceeds unauthenticated — fine
 *  for a read, and the server's 401/403 on a mutation is what
 *  src/data/remote/authPromptLink.ts (Task 9) reacts to. */
export const getAuthHeaders = (): Promise<Record<string, string>> => authApi.getAuthorizationHeaders()

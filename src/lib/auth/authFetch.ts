/** One refresh-and-retry on a 401 (spec §5.1). Anything else — including a 403 RBAC denial — passes through untouched. The retry
 *  re-sends the same request (tRPC batches carry a string body), changing only the Authorization header. */
export function createAuthFetch(session: { forceRefresh(): Promise<string | null> }, baseFetch: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    const first = await baseFetch(input, init)
    if (first.status !== 401) return first
    const token = await session.forceRefresh()
    if (!token) return first
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return baseFetch(input, { ...init, headers })
  }
}

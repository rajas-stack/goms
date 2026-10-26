import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'
import { authApi, useAuthUser } from '@/lib/auth'
import { getAuthHeaders } from '@/data/remote/authHeaders'
import { useQuery } from '@tanstack/react-query'
import { definePermissionNodes } from '@/lib/rbacTree/registry'
import { EMAIL_ACTIONS, EMAIL_ACTION_LABELS } from '@goms/domain'

definePermissionNodes('email', EMAIL_ACTIONS.map(value => ({ value, label: EMAIL_ACTION_LABELS[value] })), { kind: 'section' })
let currentEmail: string | null = null
authApi.subscribe(user => { currentEmail = user?.email?.toLowerCase() ?? null })
const clients = new Map<string, ReturnType<typeof createTRPCClient<AppRouter>>>()
export function emailApi(actorEmail: string) {
  const expected = actorEmail.toLowerCase()
  if (!import.meta.env.VITE_API_BASE_URL) throw new Error('Email Center requires the connected GOMS server.')
  if (!clients.has(expected)) clients.set(expected, createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc`, fetch: authApi.fetch, headers: async () => {
    if (currentEmail !== expected) throw new Error('Your signed-in account changed. Reopen Email Center.')
    const headers = await getAuthHeaders()
    if (currentEmail !== expected) throw new Error('Your signed-in account changed. Reopen Email Center.')
    return headers
  } })] }))
  return clients.get(expected)!.emailCenter
}
/** Reopening correspondence or access views must recheck the server, including after a grant is revoked.
 *  Dispose of message bodies when their last viewer unmounts; account-keyed caching alone cannot revoke access. */
export const emailQueryDefaults = { staleTime: 0, gcTime: 0, retry: false as const, refetchOnWindowFocus: true }
export function useEmailStatus() {
  const { user } = useAuthUser(); const email = user?.email?.toLowerCase() ?? ''
  return useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'status'], enabled: !!email, queryFn: () => emailApi(email).status.query() })
}

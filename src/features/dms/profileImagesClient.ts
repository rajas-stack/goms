import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppRouter } from '../../../apps/api/src/index'
import { authApi, useAuthUser } from '@/lib/auth'
import { getAuthHeaders } from '@/data/remote/authHeaders'

const base = import.meta.env.VITE_API_BASE_URL
export const profileImagesApi = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${base ?? ''}/api/trpc`, headers: getAuthHeaders, fetch: authApi.fetch })] }).profileImages
export const PROFILE_IMAGES_QUERY = ['profileImages'] as const
const event = 'goms:profile-images-updated'
export function notifyProfileImages() {
  window.dispatchEvent(new Event(event))
  if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel(event); channel.postMessage('refresh'); channel.close() }
}
export function useProfileImages() {
  const { user } = useAuthUser(); const client = useQueryClient()
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: PROFILE_IMAGES_QUERY }) }
    window.addEventListener(event, refresh)
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(event) : null
    if (channel) channel.onmessage = refresh
    return () => { window.removeEventListener(event, refresh); channel?.close() }
  }, [client])
  return useQuery({ queryKey: [...PROFILE_IMAGES_QUERY, 'index', user?.email], queryFn: () => profileImagesApi.index.query(),
    enabled: !!base && !!user?.email, staleTime: 10_000, refetchInterval: 15_000, gcTime: 0, retry: false })
}

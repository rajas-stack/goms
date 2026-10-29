import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { useProfileImagesIndex } from './ProfileImagesContext'
import { notifyProfileImages, PROFILE_IMAGES_QUERY, profileImagesApi } from './profileImagesClient'

type RefreshResult = Awaited<ReturnType<typeof profileImagesApi.refresh.mutate>>

export function refreshMessage(result: RefreshResult): string {
  if (result.error) return `Photos could not be refreshed: ${result.error}`
  const waiting = result.waiting?.length ?? 0
  return `Photos refreshed: ${result.matchedCount} of ${result.imageCount} matched${waiting ? ` · ${waiting} waiting for a matching name` : ''}.`
}

const PHOTO_SYNC_MS = 60_000

/** Every 60 s (while the tab is visible) pulls only Drive changes since the last sync (renames, new or
 *  replaced photos), re-matches them against every Employee, Sales and team roster, and updates all avatars. */
export function RefreshPhotosButton() {
  const profiles = useProfileImagesIndex()
  // Browser-only mode connects and syncs from Settings › DMS › Profile Images instead.
  return import.meta.env.VITE_API_BASE_URL && profiles?.configured ? <AutoRefreshPhotos /> : null
}

function AutoRefreshPhotos() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const lastError = useRef('')

  useEffect(() => {
    let running = false
    async function refresh() {
      if (running || document.hidden) return
      running = true
      try {
        const result = await profileImagesApi.refresh.mutate()
        notifyProfileImages()
        await queryClient.invalidateQueries({ queryKey: PROFILE_IMAGES_QUERY })
        report(result.error ? refreshMessage(result) : '')
      } catch (error) {
        report(error instanceof Error ? error.message : 'Photos could not be refreshed.')
      } finally {
        running = false
      }
    }
    // Toast a failure once, not every minute while it persists.
    function report(message: string) {
      if (message && message !== lastError.current) toast(message, undefined, 'error')
      lastError.current = message
    }
    const timer = window.setInterval(() => void refresh(), PHOTO_SYNC_MS)
    return () => window.clearInterval(timer)
  }, [queryClient, toast])

  return null
}

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { useProfileImagesIndex } from './ProfileImagesContext'
import { notifyProfileImages, PROFILE_IMAGES_QUERY, profileImagesApi } from './profileImagesClient'

type RefreshResult = Awaited<ReturnType<typeof profileImagesApi.refresh.mutate>>

export function refreshMessage(result: RefreshResult): string {
  if (result.error) return `Photos could not be refreshed: ${result.error}`
  const waiting = result.waiting?.length ?? 0
  return `Photos refreshed: ${result.matchedCount} of ${result.imageCount} matched${waiting ? ` · ${waiting} waiting for a matching name` : ''}.`
}

/** Pulls only Drive changes since the last sync (renames, new or replaced photos) and
 *  re-matches them against every Employee, Sales and team roster, then updates all avatars. */
export function RefreshPhotosButton() {
  const profiles = useProfileImagesIndex()
  // Browser-only mode connects and syncs from Settings › DMS › Profile Images instead.
  return import.meta.env.VITE_API_BASE_URL && profiles?.configured ? <RefreshPhotos /> : null
}

function RefreshPhotos() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setBusy(true)
    try {
      const result = await profileImagesApi.refresh.mutate()
      notifyProfileImages()
      await queryClient.invalidateQueries({ queryKey: PROFILE_IMAGES_QUERY })
      toast(refreshMessage(result), undefined, result.error ? 'error' : 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Photos could not be refreshed.', undefined, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip label="Refresh employee photos from Google Drive" side="bottom" className="shrink-0">
      <Button size="sm" onClick={() => void refresh()} disabled={busy} aria-label="Refresh photos" className="h-11 lg:h-8">
        <Icon name="RefreshCw" size={15} className={cn(busy && 'animate-spin')} />
        <span className="hidden sm:inline">{busy ? 'Refreshing…' : 'Photos'}</span>
      </Button>
    </Tooltip>
  )
}

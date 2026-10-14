import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { repository } from '@/data/repository'
import { Can } from '@/lib/permissions'
import { COMPETITORS_KEY } from './api'
import { SAMPLE_COMPETITORS } from './samples'

/** Local (no API) mode only: demo data must never be written to the shared server. */
const IS_LOCAL_MODE = !import.meta.env.VITE_API_BASE_URL

/** Shown when nothing is saved yet; in local mode it can load five sample competitors. */
export function CompetitorsEmptyState() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)

  const loadSamples = async () => {
    setLoading(true)
    try {
      for (const sample of SAMPLE_COMPETITORS) await repository.createCompetitor(sample)
      toast(`Loaded ${SAMPLE_COMPETITORS.length} sample competitors.`)
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not load the samples.', undefined, 'error')
    } finally {
      await queryClient.invalidateQueries({ queryKey: COMPETITORS_KEY })
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-paper px-6 py-14 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-goms-navy/10 text-goms-navy"><Icon name="Flag" size={22} /></span>
      <p className="text-[15px] font-semibold text-ink-900">No competitors yet</p>
      <p className="mt-1 max-w-md text-[13px] text-muted">
        Add the companies you meet in bids, such as SAS, with their positioning and capabilities, so the team can compare at a glance.
      </p>
      {IS_LOCAL_MODE && (
        <Can module="bid.columns" action="create" node="settings.pre-sales.competitors">
          <Button className="mt-4" size="sm" disabled={loading} onClick={() => void loadSamples()}>
            <Icon name="Sparkles" size={14} /> {loading ? 'Loading…' : 'Load sample competitors'}
          </Button>
        </Can>
      )}
    </div>
  )
}

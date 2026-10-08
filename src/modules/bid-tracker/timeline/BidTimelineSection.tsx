import { OpportunityTimeline } from './OpportunityTimeline'
import { useBidTimeline } from './useBidTimeline'

/** The bid page's lifecycle timeline: real bid data through the adapter, then the generic component. */
export function BidTimelineSection({ bidId }: { bidId: string }) {
  const { timeline, isLoading, isClosed } = useBidTimeline(bidId)
  if (!timeline) {
    return isLoading ? <div className="mx-4 mt-4 h-24 animate-pulse rounded-card bg-panel" aria-label="Loading timeline" /> : null
  }
  return (
    <div className="px-4 pt-4">
      <OpportunityTimeline timeline={timeline} isClosed={isClosed} />
    </div>
  )
}

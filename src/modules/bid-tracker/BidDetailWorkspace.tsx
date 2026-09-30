import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { Tabs } from '@/components/ui/Tabs'
import { useBid, useBidMilestones, useBidsForGrid } from '@/lib/api'
import type { BidGridRow } from '@/lib/types'
import { ATTENTION_OPTIONS } from './gridColumns'
import { OverviewTab } from './pages/OverviewTab'
// Tasks 31/32/33 add their tabs here, following the OverviewTab pattern.

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'milestones', label: 'Milestones' },
  { value: 'commercial', label: 'Commercial & Files' },
  { value: 'protected', label: 'Protected Values' },
] as const
type Tab = (typeof TABS)[number]['value']

const ATTENTION_TONE: Record<BidGridRow['attentionFlag'], BadgeTone> = {
  dueSoon: 'amber', overdue: 'crimson', corrigendumPending: 'blue', onTrack: 'emerald',
}

export function BidDetailWorkspace() {
  const { bidId } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'overview'
  const { data: bid, isLoading } = useBid(bidId ?? null)
  const { data: milestones = [] } = useBidMilestones(bidId ?? null)
  // The grid row already joins the opportunity's name/department/city and the
  // computed attention flag; reuse it (same cache as the Master Grid) rather
  // than adding a parallel opportunity lookup for the header.
  const { data: gridRows = [] } = useBidsForGrid()
  const row = gridRows.find((r) => r.id === bidId)

  if (isLoading) return <div className="p-4 text-sm text-muted">Loading bid…</div>
  if (!bid) {
    return (
      <div className="p-4 text-sm text-muted">
        This bid no longer exists. <Link to="/bid-tracker" className="underline">Back to the Master Grid</Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <Link to="/bid-tracker" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
          <Icon name="ArrowLeft" size={12} /> Master Grid
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-lg font-semibold text-ink-900">{row?.opportunityName ?? bid.bidCode}</h1>
          <Badge tone="neutral">{bid.bidCode}</Badge>
          {row && <Badge tone={ATTENTION_TONE[row.attentionFlag]}>{ATTENTION_OPTIONS.find((o) => o.value === row.attentionFlag)?.label}</Badge>}
          {bid.status === 'archived' && <Badge tone="gray">Archived</Badge>}
        </div>
        {row && (row.departmentName || row.city) && (
          <div className="text-[13px] text-muted">{[row.departmentName, row.city].filter(Boolean).join(' · ')}</div>
        )}
      </div>
      <Tabs<Tab> value={tab} onChange={(v) => setParams({ tab: v })} tabs={TABS.map(({ value, label }) => ({ value, label }))} />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && <OverviewTab bid={bid} milestones={milestones} />}
        {/* Tasks 31/32/33 render the other tabs here. */}
      </div>
    </div>
  )
}

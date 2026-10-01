import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { useToast } from '@/components/ui/Toast'
import { Icon } from '@/components/ui/Icon'
import { Tabs } from '@/components/ui/Tabs'
import { useBid, useBidMilestones, useBidMutations, useBidsForGrid } from '@/lib/api'
import type { BidGridRow } from '@/lib/types'
import { ATTENTION_OPTIONS } from './gridColumns'
import { CommercialAndFilesTab } from './pages/CommercialAndFilesTab'
import { MilestonesTab } from './pages/MilestonesTab'
import { OverviewTab } from './pages/OverviewTab'
import { ProtectedValuesTab } from './pages/ProtectedValuesTab'

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
  const navigate = useNavigate()
  const toast = useToast()
  const { archive, unarchive, remove } = useBidMutations()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm" disabled={archive.isPending || unarchive.isPending}
            onClick={async () => {
              setActionError(null)
              try {
                if (bid.status === 'archived') await unarchive.mutateAsync(bid.id); else await archive.mutateAsync(bid.id)
              } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not update the bid.') }
            }}
          >
            <Icon name={bid.status === 'archived' ? 'ArchiveRestore' : 'Archive'} size={13} /> {bid.status === 'archived' ? 'Restore' : 'Archive'}
          </Button>
          <Button size="sm" variant="danger" onClick={() => { setActionError(null); setConfirmDelete(true) }}>
            <Icon name="Trash2" size={13} /> Delete bid
          </Button>
          {actionError && <span role="alert" className="text-[12px] text-crimson">{actionError}</span>}
        </div>
      </div>
      <Tabs<Tab> value={tab} onChange={(v) => setParams({ tab: v })} tabs={TABS.map(({ value, label }) => ({ value, label }))} />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && <OverviewTab bid={bid} milestones={milestones} />}
        {tab === 'milestones' && <MilestonesTab bidId={bid.id} />}
        {tab === 'commercial' && (
          <CommercialAndFilesTab
            bidId={bid.id}
            opportunity={row ?? { valueAmount: '', valueUnit: 'lakh', emdAmount: '', emdUnit: 'lakh' }}
          />
        )}
        {tab === 'protected' && <ProtectedValuesTab bidId={bid.id} />}
      </div>
      <ConfirmDeleteDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        itemLabel={`bid ${bid.bidCode}`}
        onConfirm={async () => {
          await remove.mutateAsync(bid.id)
          toast(`Deleted ${bid.bidCode}`)
          navigate('/bid-tracker')
        }}
      />
    </div>
  )
}

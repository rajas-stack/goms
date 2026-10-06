import { useEffect, useState } from 'react'
import { BID_SYNOPSIS_SECTIONS, type BidSynopsisSection } from '@goms/domain'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { useToast } from '@/components/ui/Toast'
import { Icon } from '@/components/ui/Icon'
import { useBid, useBidMilestones, useBidMutations, useBidsForGrid } from '@/lib/api'
import type { BidGridRow } from '@/lib/types'
import { ATTENTION_OPTIONS } from './gridColumns'
import { CommercialAndFilesTab } from './pages/CommercialAndFilesTab'
import { MilestonesTab } from './pages/MilestonesTab'
import { OverviewTab } from './pages/OverviewTab'
import { ProtectedValuesTab } from './pages/ProtectedValuesTab'
import { SynopsisTab } from './synopsis/SynopsisTab'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'scope', label: 'Scope of Work' },
  { value: 'pq', label: 'PQ' },
  { value: 'tq', label: 'TQ' },
  { value: 'manpower', label: 'Manpower' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'payment', label: 'Payment Terms' },
  { value: 'boq', label: 'BoQ' },
  { value: 'queries', label: 'Queries' },
] as const
type Tab = (typeof TABS)[number]['value']

const ATTENTION_TONE: Record<BidGridRow['attentionFlag'], BadgeTone> = {
  dueSoon: 'amber', overdue: 'crimson', corrigendumPending: 'blue', onTrack: 'emerald',
}

export function BidDetailWorkspace() {
  const { bidId } = useParams()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') === 'milestones' ? 'milestone' : params.get('tab')
  const tab: Tab = TABS.some(item => item.value === requested) ? requested as Tab : 'overview'
  const [visited, setVisited] = useState<BidSynopsisSection[]>([])
  useEffect(() => {
    if (tab !== 'overview') setVisited(current => current.includes(tab) ? current : [...current, tab])
  }, [tab])
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
          {row?.opportunityCode && (
            <span title="Opportunity ID" className="rounded border border-line bg-panel px-1.5 py-px font-mono text-[12px] font-semibold text-goms-navy">
              {row.opportunityCode}
            </span>
          )}
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
      <div role="tablist" aria-label="Bid synopsis sections" className="flex shrink-0 overflow-x-auto border-b border-line bg-white px-2 scrollbar-thin">
        {TABS.map(item => <button key={item.value} role="tab" id={`synopsis-tab-${item.value}`} aria-selected={tab === item.value}
          aria-controls={`synopsis-panel-${item.value}`} onClick={() => setParams(current => { const next = new URLSearchParams(current); next.set('tab', item.value); return next })}
          onKeyDown={event => {
            const index = TABS.findIndex(value => value.value === item.value)
            const target = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1
            if (target < 0) return
            event.preventDefault(); setParams({ tab: TABS[target].value }); document.getElementById(`synopsis-tab-${TABS[target].value}`)?.focus()
          }} tabIndex={tab === item.value ? 0 : -1}
          className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium focus-visible:focus-ring ${tab === item.value ? 'border-blue text-ink-900' : 'border-transparent text-muted hover:bg-panel hover:text-ink'}`}>
          {item.label}
        </button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && <div role="tabpanel" id="synopsis-panel-overview" aria-labelledby="synopsis-tab-overview">
          <OverviewTab bid={bid} milestones={milestones} />
          <details className="border-t border-line"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Commercial Details &amp; Files</summary>
            <CommercialAndFilesTab bidId={bid.id} opportunity={row ?? { valueAmount: '', valueUnit: 'lakh', emdAmount: '', emdUnit: 'lakh' }} />
          </details>
          <details className="border-t border-line"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Protected Values</summary><ProtectedValuesTab bidId={bid.id} /></details>
        </div>}
        {BID_SYNOPSIS_SECTIONS.filter(section => visited.includes(section) || tab === section).map(section => (
          <div key={`${bid.id}:${section}`} role="tabpanel" id={`synopsis-panel-${section}`} aria-labelledby={`synopsis-tab-${section}`} hidden={tab !== section}>
            <SynopsisTab bidId={bid.id} section={section} />
            {section === 'milestone' && <details className="border-t border-line"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Tracked Dates &amp; Corrigenda</summary><MilestonesTab bidId={bid.id} /></details>}
          </div>
        ))}
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

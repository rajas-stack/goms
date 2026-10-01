import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { useAllBidMilestones } from '@/lib/api'

const formatDue = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

/** Every live milestone across every active bid, soonest first — the
 *  portfolio view ("what's due across all bids"). One bid's own milestones,
 *  editable, live in its detail workspace (MilestonesTab). */
export function MilestonesDatesPage() {
  const { data: milestones = [], isLoading } = useAllBidMilestones()
  const navigate = useNavigate()
  if (isLoading) return <div className="p-4 text-sm text-muted">Loading milestones…</div>
  if (milestones.length === 0) return <div className="p-6 text-center text-sm text-muted">No milestones yet.</div>

  // The API already sorts soonest-first; sorting again keeps the page correct
  // for any data source (undated milestones last).
  const sorted = [...milestones].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 bg-paper text-left text-[13px] font-medium text-ink">
          <tr>
            {['Opportunity', 'Milestone', 'Due', 'Venue', 'Status'].map((h) => (
              <th key={h} scope="col" className="border-b border-line px-3 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr
              key={m.id} className="cursor-pointer hover:bg-ink-900/[0.03]"
              onClick={() => navigate(`/bid-tracker/bid/${m.bidId}?tab=milestones`)}
            >
              <td className="border-b border-line px-3 py-2">{m.opportunityName} <span className="text-xs text-muted">{m.bidCode}</span></td>
              <td className="border-b border-line px-3 py-2">{m.label}</td>
              <td className="border-b border-line px-3 py-2 tabular-nums">{formatDue(m.dueAt)}</td>
              <td className="border-b border-line px-3 py-2">{m.venue ?? '—'}</td>
              <td className="border-b border-line px-3 py-2"><Badge tone={m.status === 'completed' ? 'emerald' : 'neutral'}>{m.status === 'completed' ? 'Completed' : 'Open'}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

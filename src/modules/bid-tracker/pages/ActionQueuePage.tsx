import { useNavigate } from 'react-router-dom'
import { BID_STAGES } from '@goms/domain'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { useBidActionQueue, useSalesPersons } from '@/lib/api'
import { ATTENTION_OPTIONS } from '../gridColumns'

const ATTENTION_TONE: Record<string, BadgeTone> = { dueSoon: 'amber', overdue: 'crimson', corrigendumPending: 'blue', onTrack: 'emerald' }
const stageLabel = (key: string) => BID_STAGES.find((s) => s.key === key)?.label ?? key

/** Every open next action across all active bids, soonest first (the API
 *  orders it), each opening its bid. */
export function ActionQueuePage() {
  const { data: entries = [], isLoading } = useBidActionQueue()
  const { data: people = [] } = useSalesPersons()
  const navigate = useNavigate()
  if (isLoading) return <div className="p-4 text-sm text-muted">Loading actions…</div>
  if (entries.length === 0) {
    return <div className="p-6 text-center text-sm text-muted" data-testid="action-queue-empty">No open actions. Next actions added to a bid appear here.</div>
  }
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? '—' : 'Unassigned')
  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 bg-paper">
          <tr>
            {['Opportunity / Mission', 'Bid ID', 'Stage', 'Next Action', 'Action Owner', 'Action Due', 'Attention'].map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-line px-3 py-2 text-left text-[13px] font-medium text-ink">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.followUpId} data-testid="action-row" className="cursor-pointer hover:bg-ink-900/[0.03]" onClick={() => navigate(`/bid-tracker/bid/${e.bidId}`)}>
              <td className="border-b border-line px-3 py-2">{e.opportunityName}</td>
              <td className="border-b border-line px-3 py-2">{e.bidCode}</td>
              <td className="border-b border-line px-3 py-2">{stageLabel(e.stageKey)}</td>
              <td className="border-b border-line px-3 py-2">{e.note || '—'}</td>
              <td className="border-b border-line px-3 py-2">{nameOf(e.assigneeId)}</td>
              <td className="whitespace-nowrap border-b border-line px-3 py-2">{e.dueDate}</td>
              <td className="border-b border-line px-3 py-2">
                <Badge tone={ATTENTION_TONE[e.attentionFlag]}>{ATTENTION_OPTIONS.find((o) => o.value === e.attentionFlag)?.label}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

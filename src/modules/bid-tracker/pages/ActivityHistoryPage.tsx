import { Link } from 'react-router-dom'
import { useBidsForGrid, useOwnershipAssignments, useSalesPersons } from '@/lib/api'
import type { OwnershipAssignment, SalesPerson } from '@/lib/types'
import { useAuditLogs } from '@/modules/commercial-calculator/api'
import type { CommercialAuditLog } from '@/modules/commercial-calculator/types'

/** Every audit entity type Bid Tracker writes. `bid` and `bidCustomFieldValue`
 *  entries are keyed to a bid id; the rest are keyed to their own rows. */
const BID_ENTITY_TYPES = ['bid', 'bidMilestone', 'bidCorrigendum', 'bidSavedView', 'bidCustomField', 'bidCustomFieldValue']
const BID_KEYED = new Set(['bid', 'bidCustomFieldValue'])

interface ActivityEntry { id: string; changedAt: string; changedBy: string | null; description: string; bidId: string | null }

function toAuditEntry(log: CommercialAuditLog): ActivityEntry {
  const what = log.oldValue || log.newValue
    ? `${log.field}: ${log.oldValue || '—'} → ${log.newValue || '—'}`
    : `${log.field} (${log.action.replace(/_/g, ' ')})`
  return {
    id: `audit:${log.id}`, changedAt: log.changedAt, changedBy: log.changedBy,
    description: log.reason ? `${what} — ${log.reason}` : what,
    bidId: BID_KEYED.has(log.entityType) ? log.entityId : null,
  }
}

function toOwnershipEntry(a: OwnershipAssignment, people: SalesPerson[]): ActivityEntry {
  const span = a.endDate ? `${a.startDate} → ${a.endDate}` : `from ${a.startDate}, still open`
  const who = people.find((p) => p.id === a.salesPersonId)?.name ?? a.salesPersonId
  return {
    id: `ownership:${a.id}`, changedAt: a.createdAt, changedBy: a.createdBy,
    description: `Owner assigned (${a.role}): ${who} (${span})`, bidId: a.entityId,
  }
}

/** Bid Tracker history: audit-log field edits AND ownership assignments merged
 *  into one newest-first feed (they tell different halves of what happened to
 *  a bid). Entries for a hard-deleted bid keep showing, labelled, because
 *  audit rows outlive their bid. */
export function ActivityHistoryPage() {
  const { data: logs = [], isLoading: logsLoading } = useAuditLogs()
  const { data: assignments = [], isLoading: assignmentsLoading } = useOwnershipAssignments()
  const { data: people = [] } = useSalesPersons()
  const { data: bids = [] } = useBidsForGrid()
  if (logsLoading || assignmentsLoading) return <div className="p-4 text-sm text-muted">Loading history…</div>

  const existing = new Set(bids.map((b) => b.id))
  const merged = [
    ...logs.filter((l) => BID_ENTITY_TYPES.includes(l.entityType)).map(toAuditEntry),
    ...assignments.filter((a) => a.entityType === 'bid').map((a) => toOwnershipEntry(a, people)),
  // Parsed, not string-compared: ownership rows can carry a bare date while audit rows carry a full timestamp.
  ].sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt))

  if (merged.length === 0) return <div className="p-6 text-center text-sm text-muted" data-testid="history-empty">No activity yet.</div>
  return (
    <div className="h-full overflow-auto p-4">
      {merged.map((entry) => {
        const deleted = !!entry.bidId && !existing.has(entry.bidId)
        return (
          <div key={entry.id} data-testid="activity-entry" className="border-b border-line py-2 text-sm">
            <div className="text-ink">
              {entry.description}{' '}
              {deleted && <span className="italic text-muted">(this bid was deleted)</span>}
              {entry.bidId && !deleted && <Link to={`/bid-tracker/bid/${entry.bidId}`} className="ml-1 text-[12px] underline">Open bid</Link>}
            </div>
            <div className="text-[12px] text-muted">{entry.changedBy ?? '—'} · {new Date(entry.changedAt).toLocaleString()}</div>
          </div>
        )
      })}
    </div>
  )
}

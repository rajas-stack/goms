import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Input, Select } from '@/components/ui/Field'
import { PersonName } from '@/components/ui/PersonName'
import { useBoqs } from '../api'
import type { BoqStatus } from '../types'

/** Exported so ProposalDetail.tsx (the shared route this list now navigates
 *  into) reuses the exact same status-label mapping rather than a second
 *  copy that could drift. */
export const STATUS_LABEL: Record<BoqStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review', approved: 'Approved',
  rejected: 'Rejected', cancelled: 'Cancelled', archived: 'Archived',
}
const STATUS_STYLE: Record<BoqStatus, string> = {
  draft: 'bg-ink-900/[0.06] text-ink-600', submitted: 'bg-sky-50 text-sky-700', under_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-ink-900/[0.06] text-ink-500', archived: 'bg-ink-900/[0.06] text-ink-500',
}

/** The list/search surface for existing BOQs — a separate top-level page
 *  from Create BOQ (different intention: find/manage vs. start new), per
 *  the IA redesign. Opening a row no longer swaps in an inline detail pane —
 *  it navigates to the shared proposal-detail route
 *  (`/commercial-calculator/boq/:boqId`, see ProposalDetail.tsx), the same
 *  route Create BOQ hands off to once a draft exists (IA redesign §6: two
 *  entry points, one journey). */
export function BoqManagement() {
  const { data: boqs = [] } = useBoqs()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return boqs.filter((b) => {
      const matchesQuery = !q || b.boqNumber.toLowerCase().includes(q) || b.opportunityName.toLowerCase().includes(q)
        || b.customerName.toLowerCase().includes(q)
      const matchesStatus = !statusFilter || b.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [boqs, query, statusFilter])

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="BOQ number, opportunity, customer…" className="pl-9" />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-48">
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as BoqStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
      </div>

      {filtered.length === 0 && <p className="py-10 text-center text-[13px] text-muted">No BOQs match.</p>}
      <div className="flex flex-col gap-1.5">
        {filtered.map((b) => (
          <button
            key={b.id}
            onClick={() => navigate(`/commercial-calculator/boq/${b.id}`)}
            className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:bg-panel"
          >
            <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{b.boqNumber}</span>
            {b.boqVersion > 1 && (
              <span className="shrink-0 rounded-full bg-ink-900/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-ink-600">v{b.boqVersion}</span>
            )}
            <span className="flex min-w-0 flex-1 items-center gap-1 text-[13px] text-ink-900">
              <span className="min-w-0 shrink truncate">{b.opportunityName}</span>
              {b.customerName && (
                <>
                  <span className="shrink-0 text-muted">·</span>
                  <PersonName person={{ name: b.customerName }} size="2xs" className="max-w-[45%] shrink-0" />
                </>
              )}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[b.status]}`}>{STATUS_LABEL[b.status]}</span>
            <span className="shrink-0 text-[12px] font-medium text-ink-700">{b.currency} {b.grandTotal.toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

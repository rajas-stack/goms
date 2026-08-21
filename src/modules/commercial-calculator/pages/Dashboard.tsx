import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useBoqs, useDashboardMetrics } from '../api'
import { isBoqPendingApproval } from '../repository-logic'
import type { CommercialBoq } from '../types'

type Category = 'draft' | 'pendingApproval' | 'approved' | 'rejected'

function KpiCard({ label, value, icon, tone, active, onClick }: {
  label: string; value: string; icon: string; tone?: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-4 rounded-2xl border px-6 py-6 text-left shadow-sm transition-colors',
        active ? 'border-ink-900 bg-ink-900/[0.04]' : 'border-line bg-white hover:bg-panel/60',
      )}
    >
      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${tone ?? 'bg-panel text-ink-700'}`}>
        <Icon name={icon} size={24} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-3xl font-semibold leading-tight text-ink-900">{value}</div>
        <div className="truncate text-sm text-muted">{label}</div>
      </div>
    </button>
  )
}

const STATUS_STYLE: Record<CommercialBoq['status'], string> = {
  draft: 'bg-ink-900/[0.06] text-ink-600', submitted: 'bg-sky-50 text-sky-700', under_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-ink-900/[0.06] text-ink-500', archived: 'bg-ink-900/[0.06] text-ink-500',
}

function BoqRow({ boq, onOpen }: { boq: CommercialBoq; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:bg-panel/60"
    >
      <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{boq.boqNumber}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{boq.opportunityName}</span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[boq.status]}`}>{boq.status}</span>
    </button>
  )
}

const CATEGORY_META: Record<Category, { title: string; icon: string; emptyLabel: string }> = {
  draft: { title: 'Draft', icon: 'FileText', emptyLabel: 'No drafts in progress.' },
  pendingApproval: { title: 'Pending Approval', icon: 'Clock', emptyLabel: 'Nothing waiting on approval.' },
  approved: { title: 'Approved', icon: 'Check', emptyLabel: 'No approved BOQs.' },
  rejected: { title: 'Rejected', icon: 'UserX', emptyLabel: 'No rejected BOQs.' },
}

/** Commercial Calculator's landing page — a WORK dashboard, not an admin one
 *  (stakeholder direction, 2026-08-03 redesign): the header CTA and the BOQ
 *  work-queues (draft/pending/approved/rejected) are the point; there is
 *  deliberately no "Manage Masters/BOM/SKU" quick-actions block here — those
 *  are administration functions and shouldn't compete for attention with the
 *  commercial workflow. The KPI cards are count-only click-to-filter
 *  controls (2026-08-19 pricing overhaul spec §9) — Commercial Value/Average
 *  Margin cards are gone since margin now lives at the pricing-level/line
 *  level, not as a document-wide average. */
export function Dashboard({ onCreateBoq, onNavigate }: {
  onCreateBoq: () => void
  onNavigate: (section: string) => void
}) {
  const { data: metrics } = useDashboardMetrics()
  const { data: boqs = [] } = useBoqs()
  const [selected, setSelected] = useState<Category | null>(null)

  const byRecency = (a: CommercialBoq, b: CommercialBoq) => (a.lastModifiedAt < b.lastModifiedAt ? 1 : -1)
  const boqsByCategory: Record<Category, CommercialBoq[]> = useMemo(() => ({
    draft: boqs.filter((b) => b.status === 'draft').sort(byRecency),
    pendingApproval: boqs.filter((b) => isBoqPendingApproval(b.status)).sort(byRecency),
    approved: boqs.filter((b) => b.status === 'approved').sort(byRecency),
    rejected: boqs.filter((b) => b.status === 'rejected').sort(byRecency),
  }), [boqs])

  const openBoq = (id: string) => onNavigate(`boq/${id}`)

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-line bg-white p-6 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">Commercial Calculator</h1>
          <p className="mt-1 text-sm text-muted">Build, price, and track commercial proposals across every AMNEX vertical.</p>
        </div>
        <Button variant="primary" size="md" onClick={onCreateBoq} className="h-14 w-full shrink-0 px-6 text-base sm:w-auto">
          <Icon name="Plus" size={20} />
          Create New BOQ
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Draft" value={String(metrics?.draft ?? 0)} icon="FileText" active={selected === 'draft'} onClick={() => setSelected('draft')} />
        <KpiCard label="Pending Approval" value={String(metrics?.pendingApproval ?? 0)} icon="Clock" tone="bg-amber-50 text-amber-700" active={selected === 'pendingApproval'} onClick={() => setSelected('pendingApproval')} />
        <KpiCard label="Approved" value={String(metrics?.approved ?? 0)} icon="Check" tone="bg-emerald-50 text-emerald-700" active={selected === 'approved'} onClick={() => setSelected('approved')} />
        <KpiCard label="Rejected" value={String(metrics?.rejected ?? 0)} icon="UserX" tone="bg-rose-50 text-rose-700" active={selected === 'rejected'} onClick={() => setSelected('rejected')} />
      </div>

      {selected && (
        <div className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
            <Icon name={CATEGORY_META[selected].icon} size={13} />
            {CATEGORY_META[selected].title} ({boqsByCategory[selected].length})
          </h2>
          {boqsByCategory[selected].length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[13px] text-muted">{CATEGORY_META[selected].emptyLabel}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {boqsByCategory[selected].map((b) => <BoqRow key={b.id} boq={b} onOpen={() => openBoq(b.id)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

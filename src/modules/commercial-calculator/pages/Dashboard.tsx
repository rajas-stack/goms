import { useMemo } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { useAuditLogs, useBoqs, useDashboardMetrics } from '../api'
import { isBoqPendingApproval } from '../repository-logic'
import type { CommercialAuditLog, CommercialBoq } from '../types'

function KpiCard({ label, value, icon, tone }: { label: string; value: string; icon: string; tone?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3.5 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone ?? 'bg-panel text-ink-700'}`}>
        <Icon name={icon} size={18} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xl font-semibold leading-tight text-ink-900">{value}</div>
        <div className="truncate text-[12px] text-muted">{label}</div>
      </div>
    </div>
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
      <span className="shrink-0 text-[12px] font-medium text-ink-700">{boq.currency} {boq.grandTotal.toLocaleString()}</span>
    </button>
  )
}

function BoqGroup({ title, icon, boqs, emptyLabel, onOpen }: {
  title: string; icon: string; boqs: CommercialBoq[]; emptyLabel: string; onOpen: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
        <Icon name={icon} size={13} />
        {title} {boqs.length > 0 && <span className="text-ink-400">({boqs.length})</span>}
      </h2>
      {boqs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[13px] text-muted">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {boqs.slice(0, 5).map((b) => <BoqRow key={b.id} boq={b} onOpen={() => onOpen(b.id)} />)}
        </div>
      )}
    </div>
  )
}

function ActivityRow({ entry }: { entry: CommercialAuditLog }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]">
      <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[10px] font-mono uppercase text-ink-700">{entry.entityType}</span>
      <span className="min-w-0 flex-1 truncate text-ink-800">
        {entry.action}{entry.field ? ` · ${entry.field}` : ''}{entry.newValue ? `: ${entry.newValue}` : ''}
      </span>
      <span className="shrink-0 text-[11px] text-muted">{new Date(entry.changedAt).toLocaleString()}</span>
    </div>
  )
}

/** Commercial Calculator's landing page — a WORK dashboard, not an admin one
 *  (stakeholder direction, 2026-08-03 redesign): the header CTA and the BOQ
 *  work-queues (draft/pending/approved/rejected) are the point; there is
 *  deliberately no "Manage Masters/BOM/SKU" quick-actions block here — those
 *  are administration functions and shouldn't compete for attention with the
 *  commercial workflow. */
export function Dashboard({ onCreateBoq, onNavigate }: {
  onCreateBoq: () => void
  onNavigate: (section: string) => void
}) {
  const { data: metrics } = useDashboardMetrics()
  const { data: boqs = [] } = useBoqs()
  const { data: activity = [] } = useAuditLogs()

  const byRecency = (a: CommercialBoq, b: CommercialBoq) => (a.lastModifiedAt < b.lastModifiedAt ? 1 : -1)
  const drafts = useMemo(() => boqs.filter((b) => b.status === 'draft').sort(byRecency), [boqs])
  const pending = useMemo(() => boqs.filter((b) => isBoqPendingApproval(b.status)).sort(byRecency), [boqs])
  const approved = useMemo(() => boqs.filter((b) => b.status === 'approved').sort(byRecency), [boqs])
  const rejected = useMemo(() => boqs.filter((b) => b.status === 'rejected').sort(byRecency), [boqs])

  const openBoq = (id: string) => onNavigate(`boq-management?boq=${id}`)

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Draft" value={String(metrics?.draft ?? 0)} icon="FileText" />
        <KpiCard label="Pending Approval" value={String(metrics?.pendingApproval ?? 0)} icon="Clock" tone="bg-amber-50 text-amber-700" />
        <KpiCard label="Approved" value={String(metrics?.approved ?? 0)} icon="Check" tone="bg-emerald-50 text-emerald-700" />
        <KpiCard label="Rejected" value={String(metrics?.rejected ?? 0)} icon="UserX" tone="bg-rose-50 text-rose-700" />
        <KpiCard label="Commercial Value" value={(metrics?.totalCommercialValue ?? 0).toLocaleString()} icon="TrendingUp" />
        <KpiCard label="Average Margin" value={`${(metrics?.averageMargin ?? 0).toFixed(1)}%`} icon="PieChart" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BoqGroup title="Continue Draft" icon="FileText" boqs={drafts} emptyLabel="No drafts in progress." onOpen={openBoq} />
        <BoqGroup title="Pending Approvals" icon="Clock" boqs={pending} emptyLabel="Nothing waiting on approval." onOpen={openBoq} />
        <BoqGroup title="Recently Approved" icon="Check" boqs={approved} emptyLabel="No approvals yet." onOpen={openBoq} />
        <BoqGroup title="Recently Rejected" icon="UserX" boqs={rejected} emptyLabel="No rejections." onOpen={openBoq} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
          <Icon name="Clock" size={13} />
          Recent Activity
        </h2>
        {activity.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[13px] text-muted">Nothing recorded yet.</p>
        ) : (
          <div className="flex flex-col rounded-xl border border-line bg-white px-2 py-1">
            {activity.slice(0, 8).map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
          </div>
        )}
      </div>

      {/* Administration surfaces get a small text-link row, not competing
          quick-action buttons — this module is a proposal tool first. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <span>Administration:</span>
        <button onClick={() => onNavigate('sku-catalog')} className="underline-offset-2 hover:text-ink-800 hover:underline">SKU Catalog</button>
        <button onClick={() => onNavigate('masters')} className="underline-offset-2 hover:text-ink-800 hover:underline">Masters</button>
        <button onClick={() => onNavigate('audit-log')} className="underline-offset-2 hover:text-ink-800 hover:underline">Audit Log</button>
      </div>
    </div>
  )
}

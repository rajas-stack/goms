import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { useBoqs, useDashboardMetrics } from '../api'
import type { CommercialBoq } from '../types'

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

function QuickAction({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-ink-600/30 hover:bg-panel/60"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel text-ink-700">
        <Icon name={icon} size={16} />
      </div>
      <span className="text-sm font-medium text-ink-900">{label}</span>
    </button>
  )
}

const STATUS_STYLE: Record<CommercialBoq['status'], string> = {
  draft: 'bg-ink-900/[0.06] text-ink-600', submitted: 'bg-sky-50 text-sky-700', under_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-ink-900/[0.06] text-ink-500', archived: 'bg-ink-900/[0.06] text-ink-500',
}

/** Commercial Calculator's landing page (spec §11). Header CTA + KPI cards +
 *  recent BOQs + quick actions — the Dashboard, not Masters, is what a user
 *  sees first. */
export function Dashboard({ onCreateBoq, onNavigate }: {
  onCreateBoq: () => void
  onNavigate: (section: string) => void
}) {
  const { data: metrics } = useDashboardMetrics()
  const { data: boqs = [] } = useBoqs()
  const recent = boqs.slice(0, 5)

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-900">Commercial Calculator</h1>
          <p className="text-[13px] text-muted">Build, price, and track commercial BOQs across every AMNEX vertical.</p>
        </div>
        <Button variant="primary" size="md" onClick={onCreateBoq} className="text-base">
          <Icon name="Plus" size={18} />
          Create BOQ
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Draft BOQs" value={String(metrics?.draft ?? 0)} icon="FileText" />
        <KpiCard label="Pending Approval" value={String(metrics?.pendingApproval ?? 0)} icon="Clock" tone="bg-amber-50 text-amber-700" />
        <KpiCard label="Approved" value={String(metrics?.approved ?? 0)} icon="Check" tone="bg-emerald-50 text-emerald-700" />
        <KpiCard label="Rejected" value={String(metrics?.rejected ?? 0)} icon="UserX" tone="bg-rose-50 text-rose-700" />
        <KpiCard label="Total Commercial Value" value={(metrics?.totalCommercialValue ?? 0).toLocaleString()} icon="TrendingUp" />
        <KpiCard label="Average Margin" value={`${(metrics?.averageMargin ?? 0).toFixed(1)}%`} icon="PieChart" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Recent BOQs</h2>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line py-10 text-center">
              <Icon name="FileSpreadsheet" size={20} className="text-muted" />
              <p className="text-sm text-muted">No BOQs yet — create your first one above.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((b) => (
                <button
                  key={b.id}
                  onClick={() => onNavigate('boq-management')}
                  className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:bg-panel/60"
                >
                  <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{b.boqNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{b.opportunityName}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[b.status]}`}>{b.status}</span>
                  <span className="shrink-0 text-[12px] font-medium text-ink-700">{b.currency} {b.grandTotal.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Quick Actions</h2>
          <div className="flex flex-col gap-2">
            <QuickAction label="Create BOQ" icon="Plus" onClick={onCreateBoq} />
            <QuickAction label="BOQ Management" icon="FileSpreadsheet" onClick={() => onNavigate('boq-management')} />
            <QuickAction label="Manage SKU Catalog" icon="Boxes" onClick={() => onNavigate('sku-catalog')} />
            <QuickAction label="Manage Commercial BOM" icon="Layers" onClick={() => onNavigate('commercial-bom')} />
            <QuickAction label="Manage Masters" icon="SlidersHorizontal" onClick={() => onNavigate('masters')} />
            <QuickAction label="View Audit Log" icon="FileText" onClick={() => onNavigate('audit-log')} />
          </div>
        </div>
      </div>
    </div>
  )
}

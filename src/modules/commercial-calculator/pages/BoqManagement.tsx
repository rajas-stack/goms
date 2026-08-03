import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useBoqLineItems, useBoqMutations, useBoqs, useSkus } from '../api'
import type { BoqStatus, CommercialBoq, CommercialBoqLineItem, CommercialSku } from '../types'

/** Mirrors repository-logic.ts's computeBoqMarginPercent, but over data
 *  already loaded by this component's own hooks rather than the server-side
 *  `CommercialCalculatorData` object, which isn't exposed to the UI layer. */
function computeMarginFromLines(lines: CommercialBoqLineItem[], skuById: Map<string, CommercialSku>): number {
  let revenue = 0
  let cost = 0
  for (const line of lines) {
    const sku = skuById.get(line.skuId)
    if (!sku) continue
    revenue += line.quantity * line.unitPrice * (1 - line.discountPct / 100)
    cost += line.quantity * (
      sku.baseSoftwareCost + sku.implementationCostPerMM + sku.integrationCost + sku.thirdPartyCost
      + sku.hardwareCost + sku.cloudCost + sku.supportCost + sku.trainingCost
    )
  }
  return revenue === 0 ? 0 : ((revenue - cost) / revenue) * 100
}

const STATUS_LABEL: Record<BoqStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review', approved: 'Approved',
  rejected: 'Rejected', cancelled: 'Cancelled', archived: 'Archived',
}
const STATUS_STYLE: Record<BoqStatus, string> = {
  draft: 'bg-ink-900/[0.06] text-ink-600', submitted: 'bg-sky-50 text-sky-700', under_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-ink-900/[0.06] text-ink-500', archived: 'bg-ink-900/[0.06] text-ink-500',
}
/** Mirrors repository-logic.ts's BOQ_TRANSITIONS for button enabling — the
 *  repository is still the enforcement point; this only avoids offering a
 *  button that would just throw. */
const NEXT_STATUSES: Record<BoqStatus, BoqStatus[]> = {
  draft: ['submitted', 'cancelled'], submitted: ['under_review', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'], approved: ['archived'], rejected: ['archived'],
  cancelled: [], archived: [],
}

export function BoqManagement() {
  const { data: boqs = [] } = useBoqs()
  const { updateStatus, revise } = useBoqMutations()
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return boqs.filter((b) => {
      const matchesQuery = !q || b.boqNumber.toLowerCase().includes(q) || b.opportunityName.toLowerCase().includes(q)
        || b.customerName.toLowerCase().includes(q)
      const matchesStatus = !statusFilter || b.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [boqs, query, statusFilter])

  const selected = boqs.find((b) => b.id === selectedId) ?? null

  async function transition(boq: CommercialBoq, next: BoqStatus) {
    const reason = window.prompt(`Reason for moving ${boq.boqNumber} to ${STATUS_LABEL[next]}?`, '')
    if (reason === null) return
    try {
      await updateStatus.mutateAsync({ id: boq.id, nextStatus: next, changeReason: reason })
      toast(`${boq.boqNumber} moved to ${STATUS_LABEL[next]}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update status.')
    }
  }

  async function handleRevise(boq: CommercialBoq) {
    const revised = await revise.mutateAsync(boq.id)
    toast(`Created revision v${revised.boqVersion} of ${revised.boqNumber}.`)
    setSelectedId(revised.id)
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[420px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-line p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="BOQ number, opportunity, customer…" className="pl-9" />
          </div>
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as BoqStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>

        {filtered.length === 0 && <p className="px-1 py-6 text-center text-[13px] text-muted">No BOQs match.</p>}
        {filtered.map((b) => (
          <button
            key={b.id}
            onClick={() => setSelectedId(b.id)}
            className={`flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-left ${
              b.id === selectedId ? 'border-ink-900/20 bg-ink-900/[0.04]' : 'border-line bg-white hover:bg-panel'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-ink-900">{b.boqNumber}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[b.status]}`}>{STATUS_LABEL[b.status]}</span>
            </div>
            <div className="truncate text-[12px] text-muted">{b.opportunityName} · {b.customerName}</div>
            <div className="text-[12px] font-medium text-ink-700">{b.currency} {b.grandTotal.toLocaleString()}</div>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Icon name="FileSpreadsheet" size={20} className="text-muted" />
            <p className="text-sm text-muted">Select a BOQ to view its details.</p>
          </div>
        ) : (
          <BoqDetail boq={selected} onTransition={transition} onRevise={handleRevise} />
        )}
      </div>
    </div>
  )
}

function BoqDetail({ boq, onTransition, onRevise }: {
  boq: CommercialBoq
  onTransition: (boq: CommercialBoq, next: BoqStatus) => void
  onRevise: (boq: CommercialBoq) => void
}) {
  const { data: lines = [] } = useBoqLineItems(boq.id)
  const { data: skus = [] } = useSkus()
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const margin = computeMarginFromLines(lines, skuById)

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">BOQ {boq.boqVersion > 1 ? `v${boq.boqVersion}` : ''}</div>
          <h2 className="text-lg font-semibold text-ink-900">{boq.boqNumber} — {boq.opportunityName}</h2>
          <p className="text-[13px] text-muted">{boq.customerName}</p>
        </div>
        <div className="flex gap-2">
          {NEXT_STATUSES[boq.status].map((next) => (
            <Button key={next} size="sm" onClick={() => onTransition(boq, next)}>{STATUS_LABEL[next]}</Button>
          ))}
          {(boq.status === 'approved' || boq.status === 'rejected' || boq.status === 'archived') && (
            <Button size="sm" onClick={() => onRevise(boq)}><Icon name="Copy" size={13} />Revise</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-xl border border-line p-3 text-sm">
        <div><div className="text-[11px] uppercase text-muted">Version</div>{boq.boqVersion} (rev {boq.revisionNumber})</div>
        <div><div className="text-[11px] uppercase text-muted">Grand Total</div>{boq.currency} {boq.grandTotal.toLocaleString()}</div>
        <div><div className="text-[11px] uppercase text-muted">Margin</div>{margin.toFixed(1)}%</div>
      </div>

      <div>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Line Items</h3>
        <div className="flex flex-col gap-2">
          {lines.map((line) => {
            const sku = skuById.get(line.skuId)
            return (
              <div key={line.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-[13px]">
                <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{sku?.skuCode ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate">{sku?.name ?? 'Unknown SKU'}</span>
                <span className="text-muted">Qty {line.quantity}</span>
                <span className="text-muted">{line.discountPct}% off</span>
                <span className="font-medium text-ink-900">{line.lineTotal.toLocaleString()}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

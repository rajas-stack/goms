import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useBoqLineItems, useBoqMutations, useBoqs, useSkus } from '../api'
import { STATUS_LABEL } from './BoqManagement'
import type { BoqStatus, CommercialBoqLineItem, CommercialSku } from '../types'

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

/** Mirrors repository-logic.ts's BOQ_TRANSITIONS for button enabling — the
 *  repository is still the enforcement point; this only avoids offering a
 *  button that would just throw. */
const NEXT_STATUSES: Record<BoqStatus, BoqStatus[]> = {
  draft: ['submitted', 'cancelled'], submitted: ['under_review', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'], approved: ['archived'], rejected: ['archived'],
  cancelled: [], archived: [],
}

/** The shared journey's "already in flight" surface (IA redesign §6) —
 *  reached either from BOQ Management's list or as Create BOQ's hand-off
 *  once a draft exists. Content is unchanged from BoqManagement.tsx's old
 *  inline `BoqDetail` — only how you arrive here changed. Preview/real
 *  approval UI/Generate/Send land here in later phases, per the IA doc's
 *  step sequence — this phase only establishes the shared destination. */
export function ProposalDetail({ boqId }: { boqId: string }) {
  const { data: boqs = [] } = useBoqs()
  const { data: lines = [] } = useBoqLineItems(boqId)
  const { data: skus = [] } = useSkus()
  const { updateStatus, revise } = useBoqMutations()
  const toast = useToast()
  const navigate = useNavigate()

  const boq = boqs.find((b) => b.id === boqId) ?? null
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const margin = boq ? computeMarginFromLines(lines, skuById) : 0

  async function transition(next: BoqStatus) {
    if (!boq) return
    const reason = window.prompt(`Reason for moving ${boq.boqNumber} to ${STATUS_LABEL[next]}?`, '')
    if (reason === null) return
    try {
      await updateStatus.mutateAsync({ id: boq.id, nextStatus: next, changeReason: reason })
      toast(`${boq.boqNumber} moved to ${STATUS_LABEL[next]}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update status.')
    }
  }

  async function handleRevise() {
    if (!boq) return
    const revised = await revise.mutateAsync(boq.id)
    toast(`Created revision v${revised.boqVersion} of ${revised.boqNumber}.`)
    navigate(`/commercial-calculator/boq/${revised.id}`)
  }

  if (!boq) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Icon name="FileSpreadsheet" size={20} className="text-muted" />
        <p className="text-sm text-muted">This BOQ could not be found.</p>
        <Button size="sm" onClick={() => navigate('/commercial-calculator/boq-management')}>Back to BOQ Management</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <button
        onClick={() => navigate('/commercial-calculator/boq-management')}
        className="mb-3 flex w-fit items-center gap-1.5 text-[12px] text-muted hover:text-ink-800"
      >
        <Icon name="ArrowLeft" size={13} />
        Back to BOQ Management
      </button>
      <div className="flex max-w-3xl flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">BOQ {boq.boqVersion > 1 ? `v${boq.boqVersion}` : ''}</div>
            <h2 className="text-lg font-semibold text-ink-900">{boq.boqNumber} — {boq.opportunityName}</h2>
            <p className="text-[13px] text-muted">{boq.customerName}</p>
          </div>
          <div className="flex gap-2">
            {NEXT_STATUSES[boq.status].map((next) => (
              <Button key={next} size="sm" onClick={() => transition(next)}>{STATUS_LABEL[next]}</Button>
            ))}
            {(boq.status === 'approved' || boq.status === 'rejected' || boq.status === 'archived') && (
              <Button size="sm" onClick={handleRevise}><Icon name="Copy" size={13} />Revise</Button>
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
    </div>
  )
}

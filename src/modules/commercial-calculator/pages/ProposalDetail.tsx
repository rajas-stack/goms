import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllEmployees, useDepartments, useSalesPersons } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { isoToday } from '@/lib/dates'
import { useAllBomItems, useBoqLineItemMutations, useBoqLineItems, useBoqMutations, useBoqs, useMasters, useSkus } from '../api'
import { buildProposalPrintHtml } from '../proposal-print'
import { computeBoqMarginPercent, resolveApprovalBand } from '../repository-logic'
import { STATUS_LABEL } from './BoqManagement'
import type { ApprovalMatrixRule, BoqStatus, CommercialBoq, CommercialBoqLineItem, CommercialSku } from '../types'

/** Mirrors repository-logic.ts's BOQ_TRANSITIONS for button enabling — the
 *  repository is still the enforcement point (including the new pending-
 *  approval gate from this plan's Task 1); this only avoids offering a
 *  button that would just throw. */
const NEXT_STATUSES: Record<BoqStatus, BoqStatus[]> = {
  draft: ['submitted', 'cancelled'], submitted: ['under_review', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'], approved: ['archived'], rejected: ['archived'],
  cancelled: [], archived: [],
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[13px] text-ink-900">{value || '—'}</div>
    </div>
  )
}

type Tab = 'overview' | 'approvals' | 'preview'

/** The shared journey's "already in flight" surface (IA redesign §6) —
 *  reached either from BOQ Management's list or as Create BOQ's hand-off
 *  once a draft exists. Three tabs, matching SkuCatalog.tsx's detail-tab
 *  convention:
 *    - Overview: status/totals/line items — unchanged from the original
 *      inline `BoqDetail` this route replaced.
 *    - Approvals: the per-line approve/reject action `PCS-031` asks for.
 *      The schema and `useBoqLineItemMutations` hook existed since Phase
 *      0/1; no screen ever called it until this tab.
 *    - Preview: the customer-facing document view, sequenced before
 *      Approval (it's a tab here, not a hard wizard step, but it's listed
 *      before Approvals in this file and in the tab strip) so sign-off is
 *      always given against real totals, not just a list of edit-state rows.
 *  Generate/Send still don't exist — separate future work. */
export function ProposalDetail({ boqId }: { boqId: string }) {
  const { data: boqs = [] } = useBoqs()
  const { data: lines = [] } = useBoqLineItems(boqId)
  const { data: skus = [] } = useSkus()
  const { data: departments = [] } = useDepartments()
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: verticals = [] } = useMasters('verticals')
  const { data: approvalMatrix = [] } = useMasters('approvalMatrix')
  const { data: currencies = [] } = useMasters('currencies')
  const { data: bomItems = [] } = useAllBomItems()
  const { updateStatus, revise } = useBoqMutations()
  const lineMutations = useBoqLineItemMutations(boqId)
  const toast = useToast()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')

  const boq = boqs.find((b) => b.id === boqId) ?? null
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const margin = boq ? computeBoqMarginPercent(boq, lines, skuById, currencies, bomItems) : 0
  const pendingCount = lines.filter((l) => l.approvalStatus === 'pending').length

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

  async function decideLine(lineId: string, decision: 'approved' | 'rejected', approverId: string, remarks: string) {
    try {
      await lineMutations.update.mutateAsync({
        id: lineId,
        patch: { approvalStatus: decision, approverId, approvalDate: isoToday(), approvalRemarks: remarks },
      })
      toast(`Line ${decision}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update line approval.')
    }
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

        <div className="flex items-center gap-1 border-b border-line">
          {(['overview', 'approvals', 'preview'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                t === tab ? 'border-b-2 border-ink-900 text-ink-900' : 'text-ink-600/70 hover:text-ink-900'
              }`}
            >
              {t === 'overview' ? 'Overview' : t === 'approvals' ? `Approvals${pendingCount > 0 ? ` (${pendingCount})` : ''}` : 'Preview'}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
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
          </>
        )}

        {tab === 'approvals' && (
          <ApprovalsTab lines={lines} skuById={skuById} approvalMatrix={approvalMatrix} onDecide={decideLine} />
        )}

        {tab === 'preview' && (
          <PreviewTab
            boq={boq}
            lines={lines}
            skuById={skuById}
            departmentName={departments.find((d) => d.id === boq.departmentId)?.name ?? '—'}
            verticalName={verticals.find((v) => v.id === boq.verticalId)?.name ?? '—'}
            salesPersonName={salesPersons.find((p) => p.id === boq.salesPersonId)?.name ?? '—'}
          />
        )}
      </div>
    </div>
  )
}

function ApprovalsTab({ lines, skuById, approvalMatrix, onDecide }: {
  lines: CommercialBoqLineItem[]
  skuById: Map<string, CommercialSku>
  approvalMatrix: ApprovalMatrixRule[]
  onDecide: (lineId: string, decision: 'approved' | 'rejected', approverId: string, remarks: string) => void
}) {
  const { data: employees = [] } = useAllEmployees()
  const [drafts, setDrafts] = useState<Record<string, { approverId: string; remarks: string }>>({})
  const pending = lines.filter((l) => l.approvalStatus === 'pending')

  if (pending.length === 0) {
    return <p className="text-[13px] text-muted">No lines currently need approval.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {pending.map((line) => {
        const sku = skuById.get(line.skuId)
        const band = resolveApprovalBand(approvalMatrix, line.discountPct)
        const draft = drafts[line.id] ?? { approverId: '', remarks: '' }
        const canDecide = draft.approverId.length > 0
        return (
          <div key={line.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{sku?.skuCode}</span>
              <span className="min-w-0 flex-1 truncate">{sku?.name}</span>
              <span className="font-medium text-amber-800">{line.discountPct}% discount — needs {band.approvalLevelLabel || band.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Approver">
                <Select
                  value={draft.approverId}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [line.id]: { ...draft, approverId: e.target.value } }))}
                >
                  <option value="">Select…</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name} — {emp.designation}</option>)}
                </Select>
              </Field>
              <Field label="Remarks">
                <Input
                  value={draft.remarks}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [line.id]: { ...draft, remarks: e.target.value } }))}
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button size="sm" variant="primary" disabled={!canDecide} onClick={() => onDecide(line.id, 'approved', draft.approverId, draft.remarks)}>
                  Approve
                </Button>
                <Button size="sm" disabled={!canDecide} onClick={() => onDecide(line.id, 'rejected', draft.approverId, draft.remarks)}>
                  Reject
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PreviewTab({ boq, lines, skuById, departmentName, verticalName, salesPersonName }: {
  boq: CommercialBoq
  lines: CommercialBoqLineItem[]
  skuById: Map<string, CommercialSku>
  departmentName: string
  verticalName: string
  salesPersonName: string
}) {
  function handlePrint() {
    const html = buildProposalPrintHtml({ boq, lines, skuById, departmentName, verticalName, salesPersonName })
    // A dedicated window rather than printing the live app: the app shell is
    // a fixed-viewport layout (scrolling panels inside `h-screen
    // overflow-hidden`), so printing it directly would clip to whatever's
    // currently visible on screen instead of the full document.
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900">Commercial Proposal — {boq.boqNumber}</h2>
          <p className="text-[13px] text-muted">{boq.opportunityName}</p>
        </div>
        <Button size="sm" onClick={handlePrint}>
          <Icon name="Printer" size={13} />
          Print / Save as PDF
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <DetailField label="Customer" value={boq.customerName} />
        <DetailField label="Organization" value={boq.customerOrganization} />
        <DetailField label="GST" value={boq.customerGst} />
        <DetailField label="Department" value={departmentName} />
        <DetailField label="Vertical" value={verticalName} />
        <DetailField label="Sales Person" value={salesPersonName} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-[12px]">
          <thead className="border-b border-line bg-panel/60 text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Unit Price</th>
              <th className="px-3 py-2 font-medium">Discount</th>
              <th className="px-3 py-2 font-medium">Tax</th>
              <th className="px-3 py-2 text-right font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const sku = skuById.get(line.skuId)
              return (
                <tr key={line.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{sku?.skuCode}</span>
                    <span className="ml-2">{sku?.name}</span>
                  </td>
                  <td className="px-3 py-2">{line.quantity}</td>
                  <td className="px-3 py-2">{line.unitPrice.toLocaleString()}</td>
                  <td className="px-3 py-2">{line.discountPct}%</td>
                  <td className="px-3 py-2">{line.taxPct}%</td>
                  <td className="px-3 py-2 text-right font-medium text-ink-900">{line.lineTotal.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end text-sm font-semibold text-ink-900">
        Grand Total: {boq.currency} {boq.grandTotal.toLocaleString()}
      </div>
    </div>
  )
}

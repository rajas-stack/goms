import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllEmployees, useCurrentPostings, useDepartments, useSalesPersons } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Collapsible } from '@/components/ui/Collapsible'
import { Combobox } from '@/components/ui/Combobox'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Menu, MenuItem, MenuDivider } from '@/components/ui/Menu'
import { useToast } from '@/components/ui/Toast'
import { convertWorkAmount, WORK_VALUE_UNITS } from '@/features/nodes/department-meta'
import { isoToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useAllBomItems, useBoqLineItemMutations, useBoqLineItems, useBoqMutations, useBoqs, useMasters, useSkus } from '../api'
import { buildProposalPrintHtml } from '../proposal-print'
import { computeBoqMarginPercent } from '../repository-logic'
import { PRICING_LEVEL_LABEL, resolveLineUnitPrice } from '../pricing-levels-logic'
import type { BulkPricingResult } from '../pricing-levels-logic'
import { SkuLinePicker } from '../components/SkuLinePicker'
import { SellingPriceSection } from '../components/SellingPriceSection'
import { LineApprovalSummary } from '../components/LineApprovalSummary'
import { BulkEditBar } from '../components/BulkEditBar'
import { STATUS_LABEL } from './BoqManagement'
import type {
  ApprovalMatrixRule, BoqStatus, CommercialBoq, CommercialBoqLineItem, CommercialBomItem, CommercialSku, UpdateBoqInput,
} from '../types'
import type { Employee } from '@/lib/types'

/** Mirrors repository-logic.ts's BOQ_TRANSITIONS for button enabling — the
 *  repository is still the enforcement point; this only avoids offering a
 *  button that would just throw. */
const NEXT_STATUSES: Record<BoqStatus, BoqStatus[]> = {
  draft: ['submitted', 'cancelled'], submitted: ['under_review', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'], approved: ['archived'], rejected: ['archived'],
  cancelled: [], archived: [],
}

/** Mirrors repository-logic.ts's `DELETABLE_BOQ_STATUSES` for button
 *  visibility — the repository is still the enforcement point. */
const DELETABLE_STATUSES: BoqStatus[] = ['draft', 'cancelled', 'rejected', 'archived']

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[13px] text-ink-900">{value || '—'}</div>
    </div>
  )
}

const SECTIONS = [
  { id: 'section-details', label: 'BOQ Details' },
  { id: 'section-lines', label: 'Line Items' },
  { id: 'section-preview', label: 'Preview' },
]

/** BOQ editable-workspace overhaul: a single continuous, section-based
 *  document rather than a tabbed report. Approvals no longer have their own
 *  tab — the same decisions now happen inline, per line, via
 *  `LineApprovalSummary`'s decision controls. */
export function ProposalDetail({ boqId }: { boqId: string }) {
  const { data: boqs = [] } = useBoqs()
  const { data: lines = [] } = useBoqLineItems(boqId)
  const { data: skus = [] } = useSkus()
  const { data: departments = [] } = useDepartments()
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const { data: preSalesList = [] } = useMasters('preSales')
  const { data: verticals = [] } = useMasters('verticals')
  const { data: approvalMatrix = [] } = useMasters('approvalMatrix')
  const { data: currencies = [] } = useMasters('currencies')
  const { data: employees = [] } = useAllEmployees()
  const { data: bomItems = [] } = useAllBomItems()
  const { update, updateStatus, revise, duplicate, remove } = useBoqMutations()
  const lineMutations = useBoqLineItemMutations(boqId)
  const toast = useToast()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null)

  function toggleExpandedLine(id: string) {
    setExpandedLineId((prev) => (prev === id ? null : id))
  }

  const boq = boqs.find((b) => b.id === boqId) ?? null
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const margin = boq ? computeBoqMarginPercent(boq, lines, skuById, currencies, bomItems) : 0
  const buSalesPersons = salesPersons.filter((p) => (postings[p.id]?.designation ?? '').toLowerCase().includes('bu sales'))

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

  async function handleDuplicate() {
    if (!boq) return
    const copy = await duplicate.mutateAsync(boq.id)
    toast(`Created ${copy.boqNumber} as a draft copy of ${boq.boqNumber}.`)
    navigate(`/commercial-calculator/boq/${copy.id}`)
  }

  async function handleDelete() {
    if (!boq) return
    await remove.mutateAsync(boq.id)
    toast(`${boq.boqNumber} deleted.`)
    navigate('/commercial-calculator/boq-management')
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
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 p-4 pb-0">
        <button
          onClick={() => navigate('/commercial-calculator/boq-management')}
          className="mb-3 flex w-fit items-center gap-1.5 text-[12px] text-muted hover:text-ink-800"
        >
          <Icon name="ArrowLeft" size={13} />
          Back to BOQ Management
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">BOQ {boq.boqVersion > 1 ? `v${boq.boqVersion}` : ''}</div>
            <h2 className="text-lg font-semibold text-ink-900">{boq.boqNumber} — {boq.opportunityName}</h2>
            <p className="text-[13px] text-muted">{boq.customerName}</p>
          </div>
          <div className="flex gap-2">
            {NEXT_STATUSES[boq.status].filter((next) => next !== 'archived').map((next) => (
              <Button key={next} size="sm" onClick={() => transition(next)}>{STATUS_LABEL[next]}</Button>
            ))}
            <Button size="sm" onClick={handleDuplicate}><Icon name="Copy" size={13} />Duplicate</Button>
            {(boq.status === 'approved' || boq.status === 'rejected' || boq.status === 'archived') && (
              <Button size="sm" onClick={handleRevise}><Icon name="Copy" size={13} />Revise</Button>
            )}
            {(NEXT_STATUSES[boq.status].includes('archived') || DELETABLE_STATUSES.includes(boq.status)) && (
              <Menu
                align="end"
                trigger={({ open, toggle }) => (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={toggle}
                    className={cn(open && 'bg-ink-900/[0.05] text-ink')}
                  >
                    <Icon name="MoreHorizontal" size={16} />
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    {NEXT_STATUSES[boq.status].includes('archived') && (
                      <MenuItem icon={<Icon name="Archive" size={15} />} onClick={() => { close(); transition('archived') }}>
                        Archive
                      </MenuItem>
                    )}
                    {NEXT_STATUSES[boq.status].includes('archived') && DELETABLE_STATUSES.includes(boq.status) && <MenuDivider />}
                    {DELETABLE_STATUSES.includes(boq.status) && (
                      <MenuItem icon={<Icon name="Trash2" size={15} />} danger onClick={() => { close(); setDeleting(true) }}>
                        Delete
                      </MenuItem>
                    )}
                  </>
                )}
              </Menu>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl border border-line p-3 text-sm">
          <div><div className="text-[11px] uppercase text-muted">Version</div>{boq.boqVersion} (rev {boq.revisionNumber})</div>
          <div><div className="text-[11px] uppercase text-muted">Grand Total</div>{boq.currency} {boq.grandTotal.toLocaleString()}</div>
          <div><div className="text-[11px] uppercase text-muted">Margin</div>{margin.toFixed(1)}%</div>
        </div>
      </div>

      <div className="sticky top-0 z-10 mt-3 flex shrink-0 gap-1 overflow-x-auto border-y border-line bg-white/95 px-4 py-1.5 backdrop-blur">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-6 p-4">
        <div id="section-details">
          <BoqDetailsSection
            boq={boq}
            departments={departments}
            salesPersons={salesPersons}
            buSalesPersons={buSalesPersons}
            verticals={verticals}
            currencies={currencies}
            preSalesList={preSalesList}
            update={update}
          />
        </div>

        <div id="section-lines">
          <LineItemsSection
            boq={boq}
            lines={lines}
            skuById={skuById}
            bomItems={bomItems}
            approvalMatrix={approvalMatrix}
            employees={employees}
            lineMutations={lineMutations}
            onDecide={decideLine}
            expandedLineId={expandedLineId}
            onToggleExpand={toggleExpandedLine}
          />
        </div>

        <div id="section-preview">
          <PreviewTab
            boq={boq}
            lines={lines}
            skuById={skuById}
            departmentName={departments.find((d) => d.id === boq.departmentId)?.name ?? '—'}
            verticalName={verticals.find((v) => v.id === boq.verticalId)?.name ?? '—'}
            salesPersonName={salesPersons.find((p) => p.id === boq.salesPersonId)?.name ?? '—'}
          />
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        itemLabel={`BOQ ${boq.boqNumber}`}
        onConfirm={handleDelete}
      />
    </div>
  )
}

type BoqDetailsDraft = Pick<CommercialBoq,
  'opportunityName' | 'departmentId' | 'customerName' | 'customerOrganization' | 'customerAddress' | 'customerContact'
  | 'verticalId' | 'budgetAmount' | 'budgetUnit' | 'budgetKnown' | 'emdAmount' | 'emdUnit'
  | 'salesPersonId' | 'currency'
> & { buSalesPersonId: string; preSalesId: string }

function fieldsFromBoq(boq: CommercialBoq): BoqDetailsDraft {
  return {
    opportunityName: boq.opportunityName, departmentId: boq.departmentId, customerName: boq.customerName,
    customerOrganization: boq.customerOrganization, customerAddress: boq.customerAddress, customerContact: boq.customerContact,
    verticalId: boq.verticalId, budgetAmount: boq.budgetAmount, budgetUnit: boq.budgetUnit, budgetKnown: boq.budgetKnown,
    emdAmount: boq.emdAmount, emdUnit: boq.emdUnit, salesPersonId: boq.salesPersonId,
    buSalesPersonId: boq.buSalesPersonId ?? '', preSalesId: boq.preSalesId ?? '', currency: boq.currency,
  }
}

/** New BOQ-level metadata editing — read-only text by default, switching to
 *  inputs behind an "Edit Details" button that's only ever shown while
 *  `boq.status === 'draft'`, matching the same frozen rule line items
 *  already follow. Covers every field `CreateBoq.tsx` sets at creation time
 *  (customerName/Contact/Address/Organization are plain text here rather
 *  than replicating Create's department-scoped stakeholder picker — a
 *  deliberate scope simplification, not a spec requirement). */
function BoqDetailsSection({ boq, departments, salesPersons, buSalesPersons, verticals, currencies, preSalesList, update }: {
  boq: CommercialBoq
  departments: { id: string; name: string }[]
  salesPersons: { id: string; name: string }[]
  buSalesPersons: { id: string; name: string }[]
  verticals: { id: string; code: string; name: string }[]
  currencies: { id: string; code: string; name: string }[]
  preSalesList: { id: string; name: string }[]
  update: ReturnType<typeof useBoqMutations>['update']
}) {
  const toast = useToast()
  const isDraft = boq.status === 'draft'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<BoqDetailsDraft>(() => fieldsFromBoq(boq))
  const [saving, setSaving] = useState(false)

  function startEditing() {
    setDraft(fieldsFromBoq(boq))
    setEditing(true)
  }
  function cancelEditing() {
    setDraft(fieldsFromBoq(boq))
    setEditing(false)
  }

  const original = fieldsFromBoq(boq)
  const dirty = (Object.keys(draft) as (keyof BoqDetailsDraft)[]).some((k) => draft[k] !== original[k])

  async function save() {
    setSaving(true)
    try {
      const patch: UpdateBoqInput = {}
      ;(Object.keys(draft) as (keyof BoqDetailsDraft)[]).forEach((k) => {
        if (draft[k] === original[k]) return
        if (k === 'buSalesPersonId' || k === 'preSalesId') {
          patch[k] = (draft[k] || null) as never
        } else {
          patch[k] = draft[k] as never
        }
      })
      if (Object.keys(patch).length > 0) {
        await update.mutateAsync({ id: boq.id, patch })
        toast('BOQ details saved.')
      }
      setEditing(false)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save BOQ details.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Collapsible
      title="BOQ Details"
      icon="Briefcase"
      badge={dirty && editing ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Unsaved changes</span> : undefined}
    >
      <div className="mb-3 flex justify-end gap-2">
        {!editing ? (
          isDraft && <Button size="sm" onClick={startEditing}><Icon name="Pencil" size={13} />Edit Details</Button>
        ) : (
          <>
            <Button size="sm" onClick={cancelEditing} disabled={saving}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {editing ? (
          <Field label="Opportunity Name">
            <Input value={draft.opportunityName} onChange={(e) => setDraft((d) => ({ ...d, opportunityName: e.target.value }))} />
          </Field>
        ) : <DetailField label="Opportunity Name" value={boq.opportunityName} />}

        {editing ? (
          <Field label="Department">
            <Combobox value={draft.departmentId} onChange={(v) => setDraft((d) => ({ ...d, departmentId: v }))} options={departments.map((d) => ({ value: d.id, label: d.name }))} aria-label="Department" />
          </Field>
        ) : <DetailField label="Department" value={departments.find((d) => d.id === boq.departmentId)?.name ?? '—'} />}

        {editing ? (
          <Field label="Vertical">
            <Combobox value={draft.verticalId} onChange={(v) => setDraft((d) => ({ ...d, verticalId: v }))} options={verticals.map((v) => ({ value: v.id, label: `${v.code} — ${v.name}` }))} aria-label="Vertical" />
          </Field>
        ) : <DetailField label="Vertical" value={verticals.find((v) => v.id === boq.verticalId)?.name ?? '—'} />}

        {editing ? (
          <Field label="Currency">
            <Select value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}>
              {currencies.map((c) => <option key={c.id} value={c.code}>{c.code} — {c.name}</option>)}
            </Select>
          </Field>
        ) : <DetailField label="Currency" value={boq.currency} />}

        {editing ? (
          <Field label="Customer Name">
            <Input value={draft.customerName} onChange={(e) => setDraft((d) => ({ ...d, customerName: e.target.value }))} />
          </Field>
        ) : <DetailField label="Customer Name" value={boq.customerName} />}

        {editing ? (
          <Field label="Organization">
            <Input value={draft.customerOrganization} onChange={(e) => setDraft((d) => ({ ...d, customerOrganization: e.target.value }))} />
          </Field>
        ) : <DetailField label="Organization" value={boq.customerOrganization} />}

        {editing ? (
          <Field label="Contact">
            <Input value={draft.customerContact} onChange={(e) => setDraft((d) => ({ ...d, customerContact: e.target.value }))} />
          </Field>
        ) : <DetailField label="Contact" value={boq.customerContact} />}

        {editing ? (
          <Field label="Sales Person">
            <Combobox value={draft.salesPersonId} onChange={(v) => setDraft((d) => ({ ...d, salesPersonId: v }))} options={salesPersons.map((p) => ({ value: p.id, label: p.name }))} aria-label="Sales Person" />
          </Field>
        ) : <DetailField label="Sales Person" value={salesPersons.find((p) => p.id === boq.salesPersonId)?.name ?? '—'} />}

        {editing ? (
          <Field label="BU Sales" hint="Filtered to Sales Persons with a &quot;BU Sales&quot; posting.">
            <Select value={draft.buSalesPersonId} onChange={(e) => setDraft((d) => ({ ...d, buSalesPersonId: e.target.value }))}>
              <option value="">None</option>
              {buSalesPersons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        ) : <DetailField label="BU Sales" value={salesPersons.find((p) => p.id === boq.buSalesPersonId)?.name ?? '—'} />}

        {editing ? (
          <Field label="Pre-Sales">
            <Select value={draft.preSalesId} onChange={(e) => setDraft((d) => ({ ...d, preSalesId: e.target.value }))}>
              <option value="">None</option>
              {preSalesList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        ) : <DetailField label="Pre-Sales" value={preSalesList.find((p) => p.id === boq.preSalesId)?.name ?? '—'} />}

        <div className="col-span-2 lg:col-span-3">
          {editing ? (
            <Field label="Address">
              <Textarea value={draft.customerAddress} onChange={(e) => setDraft((d) => ({ ...d, customerAddress: e.target.value }))} />
            </Field>
          ) : <DetailField label="Address" value={boq.customerAddress} />}
        </div>

        <div className="col-span-2 lg:col-span-3">
          {editing ? (
            <Field label="Budget Confirmed?">
              <div className="flex items-center gap-4" role="radiogroup" aria-label="Budget confirmed">
                {(['yes', 'no'] as const).map((v) => (
                  <label key={v} className="flex cursor-pointer items-center gap-1.5">
                    <input type="radio" name="editBudgetKnown" checked={draft.budgetKnown === v} onChange={() => setDraft((d) => ({ ...d, budgetKnown: v }))} className="accent-ink-900" />
                    <span className="text-sm text-ink-800">{v === 'yes' ? 'Yes' : 'No'}</span>
                  </label>
                ))}
              </div>
            </Field>
          ) : <DetailField label="Budget Confirmed?" value={boq.budgetKnown === 'yes' ? 'Yes' : boq.budgetKnown === 'no' ? 'No' : '—'} />}
        </div>

        {editing ? (
          <Field label="Budget Amount" hint={draft.budgetKnown === 'no' ? "Disabled while the budget isn't confirmed." : undefined}>
            <div className="flex gap-2">
              <Input
                value={draft.budgetAmount}
                onChange={(e) => setDraft((d) => ({ ...d, budgetAmount: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
                disabled={draft.budgetKnown === 'no'}
                className="flex-1 disabled:cursor-not-allowed disabled:bg-panel disabled:text-muted"
              />
              <Select
                value={draft.budgetUnit}
                onChange={(e) => {
                  const next = e.target.value
                  setDraft((d) => ({ ...d, budgetAmount: convertWorkAmount(d.budgetAmount, d.budgetUnit, next), budgetUnit: next }))
                }}
                disabled={draft.budgetKnown === 'no'}
                className="w-28 shrink-0 disabled:cursor-not-allowed disabled:bg-panel disabled:text-muted"
              >
                {WORK_VALUE_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
              </Select>
            </div>
          </Field>
        ) : <DetailField label="Budget Amount" value={boq.budgetAmount ? `${boq.budgetAmount} ${boq.budgetUnit}` : '—'} />}

        {editing && draft.budgetKnown === 'no' && (
          <Field label="EMD Amount">
            <div className="flex gap-2">
              <Input
                value={draft.emdAmount}
                onChange={(e) => setDraft((d) => ({ ...d, emdAmount: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
                className="flex-1"
              />
              <Select
                value={draft.emdUnit}
                onChange={(e) => {
                  const next = e.target.value
                  setDraft((d) => ({ ...d, emdAmount: convertWorkAmount(d.emdAmount, d.emdUnit, next), emdUnit: next }))
                }}
                className="w-28 shrink-0"
              >
                {WORK_VALUE_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
              </Select>
            </div>
          </Field>
        )}
        {!editing && boq.budgetKnown === 'no' && (
          <DetailField label="EMD Amount" value={boq.emdAmount ? `${boq.emdAmount} ${boq.emdUnit}` : '—'} />
        )}
      </div>
    </Collapsible>
  )
}

function LineItemsSection({ boq, lines, skuById, bomItems, approvalMatrix, employees, lineMutations, onDecide, expandedLineId, onToggleExpand }: {
  boq: CommercialBoq
  lines: CommercialBoqLineItem[]
  skuById: Map<string, CommercialSku>
  bomItems: CommercialBomItem[]
  approvalMatrix: ApprovalMatrixRule[]
  employees: Employee[]
  lineMutations: ReturnType<typeof useBoqLineItemMutations>
  onDecide: (lineId: string, decision: 'approved' | 'rejected', approverId: string, remarks: string) => void
  expandedLineId: string | null
  onToggleExpand: (id: string) => void
}) {
  const toast = useToast()
  const isDraft = boq.status === 'draft'
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedLines = lines.filter((l) => selectedIds.includes(l.id))
  const pendingCount = lines.filter((l) => l.approvalStatus === 'pending').length

  function toggleOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }
  function toggleAll() {
    setSelectedIds((prev) => (prev.length === lines.length ? [] : lines.map((l) => l.id)))
  }

  async function applyBulkResults(results: BulkPricingResult[]) {
    const failed = results.filter((r) => !r.ok)
    for (const r of results.filter((r) => r.ok)) {
      const patch: Partial<Pick<CommercialBoqLineItem, 'quantity' | 'unitPrice' | 'discountPct' | 'pricingLevels' | 'activePricingLevel'>> = {}
      if (r.quantity !== undefined) patch.quantity = r.quantity
      if (r.unitPrice !== undefined) patch.unitPrice = r.unitPrice
      if (r.discountPct !== undefined) patch.discountPct = r.discountPct
      if (r.pricingLevels !== undefined) patch.pricingLevels = r.pricingLevels
      if (r.activePricingLevel !== undefined) patch.activePricingLevel = r.activePricingLevel
      try {
        await lineMutations.update.mutateAsync({ id: r.lineId, patch })
      } catch (e) {
        failed.push({ lineId: r.lineId, ok: false, error: e instanceof Error ? e.message : 'Could not save.' })
      }
    }
    if (failed.length > 0) {
      toast(`${failed.length} line(s) could not be updated: ${failed.map((f) => f.error).join('; ')}`)
    } else {
      toast('Bulk update applied.')
    }
    setSelectedIds([])
  }

  async function applyBulkDelete(lineIds: string[]) {
    let failedCount = 0
    for (const id of lineIds) {
      try {
        await lineMutations.remove.mutateAsync(id)
      } catch {
        failedCount += 1
      }
    }
    toast(failedCount > 0 ? `${failedCount} of ${lineIds.length} line(s) could not be deleted.` : `${lineIds.length} line(s) deleted.`)
    setSelectedIds([])
  }

  async function moveLine(lineId: string, direction: 'up' | 'down') {
    const ids = lines.map((l) => l.id)
    const idx = ids.indexOf(lineId)
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (swapWith < 0 || swapWith >= ids.length) return
    const next = [...ids]
    ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
    try {
      await lineMutations.reorder.mutateAsync(next)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reorder line items.')
    }
  }

  async function duplicateLine(line: CommercialBoqLineItem) {
    try {
      await lineMutations.add.mutateAsync({
        skuId: line.skuId, quantity: line.quantity, unitPrice: line.unitPrice, discountPct: line.discountPct,
        pricingLevels: line.pricingLevels, activePricingLevel: line.activePricingLevel,
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not duplicate line item.')
    }
  }

  async function handleAdd(line: { skuId: string; quantity: number; discountPct: number; pricingLevels: CommercialBoqLineItem['pricingLevels']; activePricingLevel: CommercialBoqLineItem['activePricingLevel'] }) {
    const sku = skuById.get(line.skuId)
    if (!sku) return
    try {
      await lineMutations.add.mutateAsync({
        skuId: line.skuId, quantity: line.quantity, discountPct: line.discountPct, unitPrice: sku.listPrice,
        pricingLevels: line.pricingLevels, activePricingLevel: line.activePricingLevel,
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add line item.')
    }
  }

  return (
    <Collapsible
      title="Line Items"
      icon="FileSpreadsheet"
      badge={pendingCount > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{pendingCount} pending</span> : undefined}
    >
      {isDraft && lines.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Checkbox checked={selectedIds.length === lines.length} indeterminate={selectedIds.length > 0 && selectedIds.length < lines.length} onChange={toggleAll} aria-label="Select all lines" />
          <span className="text-[12px] text-muted">Select all</span>
        </div>
      )}
      {isDraft && selectedLines.length > 0 && (
        <div className="mb-2">
          <BulkEditBar selectedLines={selectedLines} skusById={skuById} onApply={applyBulkResults} onDelete={applyBulkDelete} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        {lines.map((line, i) => {
          const sku = skuById.get(line.skuId)
          const rowProps = { expanded: expandedLineId === line.id, onToggleExpand: () => onToggleExpand(line.id) }
          return isDraft ? (
            <div key={line.id} className="flex items-start gap-2">
              <Checkbox checked={selectedIds.includes(line.id)} onChange={() => toggleOne(line.id)} aria-label={`Select ${sku?.skuCode ?? 'line'}`} />
              <div className="flex-1">
                <DraftLineRow
                  line={line} sku={sku} bomItems={bomItems} skuById={skuById} approvalMatrix={approvalMatrix} employees={employees}
                  lineMutations={lineMutations} onDecide={onDecide} {...rowProps}
                  isFirst={i === 0} isLast={i === lines.length - 1}
                  onMoveUp={() => moveLine(line.id, 'up')} onMoveDown={() => moveLine(line.id, 'down')}
                  onDuplicate={() => duplicateLine(line)}
                />
              </div>
            </div>
          ) : (
            <NonDraftLineRow key={line.id} line={line} sku={sku} approvalMatrix={approvalMatrix} employees={employees} onDecide={onDecide} {...rowProps} />
          )
        })}
      </div>
      {isDraft && (
        <div className="mt-2">
          <SkuLinePicker verticalId={boq.verticalId} currencyCode={boq.currency} bomItems={bomItems} onAdd={handleAdd} />
        </div>
      )}
    </Collapsible>
  )
}

/** One editable line row, shown only while `boq.status === 'draft'`
 *  (`LineItemsSection` picks this branch). Quantity is a local,
 *  uncontrolled-by-the-server-value-on-every-keystroke draft — it commits
 *  once on blur/Enter, not per keystroke, and rolls back to the last known
 *  server value on a failed commit (e.g. the SKU floor-price check). */
function DraftLineRow({
  line, sku, bomItems, skuById, approvalMatrix, employees, lineMutations, onDecide,
  expanded, onToggleExpand, isFirst, isLast, onMoveUp, onMoveDown, onDuplicate,
}: {
  line: CommercialBoqLineItem
  sku: CommercialSku | undefined
  bomItems: CommercialBomItem[]
  skuById: Map<string, CommercialSku>
  approvalMatrix: ApprovalMatrixRule[]
  employees: Employee[]
  lineMutations: ReturnType<typeof useBoqLineItemMutations>
  onDecide: (lineId: string, decision: 'approved' | 'rejected', approverId: string, remarks: string) => void
  expanded: boolean
  onToggleExpand: () => void
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
}) {
  const toast = useToast()
  const [qty, setQty] = useState(String(line.quantity))

  useEffect(() => setQty(String(line.quantity)), [line.quantity])

  async function commitQuantity() {
    const next = Number(qty)
    if (!Number.isFinite(next) || next <= 0 || next === line.quantity) {
      setQty(String(line.quantity))
      return
    }
    try {
      await lineMutations.update.mutateAsync({ id: line.id, patch: { quantity: next } })
    } catch (e) {
      setQty(String(line.quantity))
      toast(e instanceof Error ? e.message : 'Could not update line item.')
    }
  }

  async function handlePricingChange(next: { pricingLevels: CommercialBoqLineItem['pricingLevels']; activePricingLevel: CommercialBoqLineItem['activePricingLevel'] }) {
    if (!sku) return
    const { unitPrice, discountPct } = resolveLineUnitPrice(sku, line.discountPct, next.pricingLevels, next.activePricingLevel)
    try {
      await lineMutations.update.mutateAsync({
        id: line.id,
        patch: { unitPrice, discountPct, pricingLevels: next.pricingLevels, activePricingLevel: next.activePricingLevel },
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update line item.')
    }
  }

  async function handleRemove() {
    try {
      await lineMutations.remove.mutateAsync(line.id)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove line item.')
    }
  }

  function commitOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5 text-[13px]">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onToggleExpand} aria-label="Toggle approval summary" className="text-muted">
          <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size={14} />
        </button>
        <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{sku?.skuCode ?? '—'}</span>
        <span className="min-w-0 flex-1 truncate">{sku?.name ?? 'Unknown SKU'}</span>
        <Input
          type="number"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={commitQuantity}
          onKeyDown={commitOnEnter}
          className="w-20"
          aria-label="Quantity"
        />
        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-700">
          {line.activePricingLevel ? PRICING_LEVEL_LABEL[line.activePricingLevel] : 'List Price'}
        </span>
        <span className="text-muted">Sell {line.unitPrice.toLocaleString()}</span>
        <span className="text-muted">{line.discountPct.toFixed(1)}% off</span>
        <span className="text-muted">{line.taxPct}% tax</span>
        <span className="font-medium text-ink-900">{line.lineTotal.toLocaleString()}</span>
        <Button size="icon" onClick={onMoveUp} disabled={isFirst} title="Move up" aria-label="Move up"><Icon name="ArrowUp" size={14} /></Button>
        <Button size="icon" onClick={onMoveDown} disabled={isLast} title="Move down" aria-label="Move down"><Icon name="ArrowDown" size={14} /></Button>
        <Button size="icon" onClick={onDuplicate} title="Duplicate line" aria-label="Duplicate line"><Icon name="Copy" size={14} /></Button>
        <Button size="icon" onClick={handleRemove} title="Remove"><Icon name="Trash2" size={14} /></Button>
      </div>
      {sku && (
        <div className="mt-2 border-t border-line pt-2">
          <SellingPriceSection
            sku={sku}
            bomItems={bomItems}
            skusById={skuById}
            pricingLevels={line.pricingLevels}
            activePricingLevel={line.activePricingLevel}
            onChange={handlePricingChange}
          />
        </div>
      )}
      {expanded && <LineApprovalSummary line={line} approvalMatrix={approvalMatrix} employees={employees} onDecide={onDecide} />}
    </div>
  )
}

function NonDraftLineRow({ line, sku, approvalMatrix, employees, onDecide, expanded, onToggleExpand }: {
  line: CommercialBoqLineItem
  sku: CommercialSku | undefined
  approvalMatrix: ApprovalMatrixRule[]
  employees: Employee[]
  onDecide: (lineId: string, decision: 'approved' | 'rejected', approverId: string, remarks: string) => void
  expanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5 text-[13px]">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onToggleExpand} aria-label="Toggle approval summary" className="text-muted">
          <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size={14} />
        </button>
        <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{sku?.skuCode ?? '—'}</span>
        <span className="min-w-0 flex-1 truncate">{sku?.name ?? 'Unknown SKU'}</span>
        <span className="text-muted">Qty {line.quantity}</span>
        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-700">
          {line.activePricingLevel ? PRICING_LEVEL_LABEL[line.activePricingLevel] : 'List Price'}
        </span>
        <span className="text-muted">{line.discountPct}% off</span>
        <span className="text-muted">{line.taxPct}% tax</span>
        <span className="font-medium text-ink-900">{line.lineTotal.toLocaleString()}</span>
      </div>
      {expanded && <LineApprovalSummary line={line} approvalMatrix={approvalMatrix} employees={employees} onDecide={onDecide} />}
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
    // a fixed-viewport layout, so printing it directly would clip to
    // whatever's currently visible on screen instead of the full document.
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <Collapsible title="Preview" icon="FileText" defaultOpen={false}>
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
    </Collapsible>
  )
}

import { Gate, usePermissions } from '@/lib/permissions'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllEmployees, useCurrentPostings, useDepartments, useSalesPersons } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Collapsible } from '@/components/ui/Collapsible'
import { Combobox } from '@/components/ui/Combobox'
import { PersonName } from '@/components/ui/PersonName'
import type { AvatarPerson } from '@/components/ui/Avatar'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Menu, MenuItem, MenuDivider } from '@/components/ui/Menu'
import { useToast } from '@/components/ui/Toast'
import { convertWorkAmount, WORK_VALUE_UNITS } from '@/features/nodes/department-meta'
import { isoToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useAllBomItems, useBoqLineItemMutations, useBoqLineItems, useBoqMutations, useBoqs, useMasters, useSkus } from '../api'
import { buildProposalPrintHtml } from '../proposal-print'
import { computeBoqMarginPercent, findBoqByOpportunityName } from '../repository-logic'
import { PRICING_LEVEL_LABEL, resolveLineUnitPrice } from '../pricing-levels-logic'
import { formatPercent, isNegativeMargin } from '../format'
import { useBoqWorkspaceShortcuts } from '../use-boq-workspace-shortcuts'
import { useStickyScrollOffset } from '../use-sticky-scroll-offset'
import type { BulkPricingResult } from '../pricing-levels-logic'
import { BOQ_WORKSPACE_SECTIONS, BoqWorkspaceHeader } from '../components/BoqWorkspaceHeader'
import { canComputeMargin } from '../restricted'
import { SkuLinePicker } from '../components/SkuLinePicker'
import { SkuSearchBar } from '../components/SkuSearchBar'
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

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[13px] text-ink-900">{value || '—'}</div>
    </div>
  )
}

/** A person's face + name, or an em dash when the field is unset/blank. */
function personOrDash(person: AvatarPerson | undefined): ReactNode {
  return person?.name ? <PersonName person={person} /> : '—'
}

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
  // Pre-sales edits BOQs; CXO may only approve / reject lines and BOQs (the server checks the field); Finance only reads.
  const allowed = usePermissions().mayWrite('com.boqs')
  const toast = useToast()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  function toggleExpandedLine(id: string) {
    setExpandedLineId((prev) => (prev === id ? null : id))
  }

  const boq = boqs.find((b) => b.id === boqId) ?? null
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const margin = boq ? computeBoqMarginPercent(boq, lines, skuById, currencies, bomItems) : 0
  const buSalesPersons = salesPersons.filter((p) => (postings[p.id]?.designation ?? '').toLowerCase().includes('bu sales'))

  useBoqWorkspaceShortcuts({
    onSave: boq?.status === 'draft' ? () => toast('All changes are saved automatically as you edit.') : undefined,
    onEscape: () => { if (expandedLineId) setExpandedLineId(null) },
  })

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickyBarRef = useRef<HTMLDivElement>(null)
  useStickyScrollOffset(scrollContainerRef, stickyBarRef)

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
    <Gate allowed={allowed}>
    <div ref={scrollContainerRef} className="flex h-full flex-col overflow-y-auto">
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
            {boq.customerName && <PersonName person={{ name: boq.customerName }} className="text-[13px] text-muted" />}
          </div>
          <div className="flex gap-2">
            {NEXT_STATUSES[boq.status]
              .filter((next) => next !== 'archived' && !(boq.status === 'draft' && next === 'submitted'))
              .map((next) => (
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
          <div>
            <div className="text-[11px] uppercase text-muted">Margin</div>
            <span className={canComputeMargin(skus) && isNegativeMargin(margin) ? 'text-rose-700' : undefined}>
              {canComputeMargin(skus) ? `${formatPercent(margin)}${isNegativeMargin(margin) ? ' — Below Cost' : ''}` : 'Restricted'}
            </span>
          </div>
        </div>
      </div>

      {/* Both bars pin together as one unit — stacking two independent
         `sticky top-0` elements would land them on the same coordinate once
         both are stuck, hiding whichever has the lower z-index behind the
         other and silently swallowing clicks meant for it. */}
      <div ref={stickyBarRef} className="sticky top-0 z-20 flex flex-col">
      <BoqWorkspaceHeader
        boqNumber={boq.boqNumber}
        statusLabel={STATUS_LABEL[boq.status]}
        customerName={boq.customerName}
        lineCount={lines.length}
        marginPct={canComputeMargin(skus) ? margin : null}
        grandTotal={boq.grandTotal}
        currencyCode={boq.currency}
        onPreview={() => {
          setPreviewOpen(true)
          document.getElementById('section-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        saveDraft={boq.status === 'draft' ? {
          onClick: () => toast('All changes are saved automatically as you edit.'),
          label: 'Save Draft',
        } : undefined}
        submit={boq.status === 'draft' ? {
          onClick: () => transition('submitted'),
          label: 'Submit',
          disabled: updateStatus.isPending,
        } : undefined}
      />

      <div className="mt-3 flex shrink-0 gap-1 overflow-x-auto border-y border-line bg-white/95 px-4 py-1.5 backdrop-blur">
        {BOQ_WORKSPACE_SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900"
          >
            {s.label}
          </button>
        ))}
      </div>
      </div>

      <div className="flex flex-col gap-6 p-4">
        <div id="section-details">
          <BoqDetailsSection
            boq={boq}
            boqs={boqs}
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
            salesPerson={salesPersons.find((p) => p.id === boq.salesPersonId)}
            open={previewOpen}
            onOpenChange={setPreviewOpen}
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
    </Gate>
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
function BoqDetailsSection({ boq, boqs, departments, salesPersons, buSalesPersons, verticals, currencies, preSalesList, update }: {
  boq: CommercialBoq
  boqs: CommercialBoq[]
  departments: { id: string; name: string }[]
  salesPersons: { id: string; name: string; photoUrl: string | null }[]
  buSalesPersons: { id: string; name: string; photoUrl: string | null }[]
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
  const opportunityNameClash = editing ? findBoqByOpportunityName(boqs, draft.opportunityName, boq.id) : null

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
            <Button size="sm" variant="primary" onClick={save} disabled={saving || !dirty || !!opportunityNameClash}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {editing ? (
          <Field label="Opportunity Name" hint="Must be unique across all BOQs.">
            <Input value={draft.opportunityName} onChange={(e) => setDraft((d) => ({ ...d, opportunityName: e.target.value }))} />
            {opportunityNameClash && (
              <p className="mt-1 text-[12px] text-rose-700">Already used by {opportunityNameClash.boqNumber}. Choose a different name.</p>
            )}
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
        ) : <DetailField label="Customer Name" value={personOrDash({ name: boq.customerName })} />}

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
            <Combobox value={draft.salesPersonId} onChange={(v) => setDraft((d) => ({ ...d, salesPersonId: v }))} options={salesPersons.map((p) => ({ value: p.id, label: p.name, person: p }))} aria-label="Sales Person" />
          </Field>
        ) : <DetailField label="Sales Person" value={personOrDash(salesPersons.find((p) => p.id === boq.salesPersonId))} />}

        {/* Empty value = "None" (the placeholder); the clear button resets to it. */}
        {editing ? (
          <Field label="BU Sales" hint="Filtered to Sales Persons with a &quot;BU Sales&quot; posting.">
            <Combobox value={draft.buSalesPersonId} onChange={(v) => setDraft((d) => ({ ...d, buSalesPersonId: v }))} options={buSalesPersons.map((p) => ({ value: p.id, label: p.name, person: p }))} placeholder="None" aria-label="BU Sales" />
          </Field>
        ) : <DetailField label="BU Sales" value={personOrDash(salesPersons.find((p) => p.id === boq.buSalesPersonId))} />}

        {editing ? (
          <Field label="Pre-Sales">
            <Combobox value={draft.preSalesId} onChange={(v) => setDraft((d) => ({ ...d, preSalesId: v }))} options={preSalesList.map((p) => ({ value: p.id, label: p.name, person: { name: p.name } }))} placeholder="None" aria-label="Pre-Sales" />
          </Field>
        ) : <DetailField label="Pre-Sales" value={personOrDash(preSalesList.find((p) => p.id === boq.preSalesId))} />}

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
  const existingSkuIds = new Set(lines.map((l) => l.skuId))

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
      {isDraft && (
        <div className="mb-3 flex flex-col gap-2">
          <SkuSearchBar verticalId={boq.verticalId} currencyCode={boq.currency} bomItems={bomItems} existingSkuIds={existingSkuIds} onAdd={handleAdd} />
          <Collapsible title="Browse Catalog" icon="Boxes" defaultOpen={false}>
            <SkuLinePicker verticalId={boq.verticalId} currencyCode={boq.currency} bomItems={bomItems} existingSkuIds={existingSkuIds} onAdd={handleAdd} />
          </Collapsible>
        </div>
      )}
      {isDraft && lines.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Checkbox checked={selectedIds.length === lines.length} indeterminate={selectedIds.length > 0 && selectedIds.length < lines.length} onChange={toggleAll} aria-label="Select all lines" />
          <span className="text-[12px] text-muted">Select all</span>
        </div>
      )}
      {isDraft && selectedLines.length > 0 && (
        <div className="mb-2">
          <BulkEditBar selectedLines={selectedLines} skusById={skuById} onApply={applyBulkResults} />
        </div>
      )}
      {lines.length === 0 ? (
        <p className="text-[13px] text-muted">No SKUs added yet — configure one above to start building the proposal.</p>
      ) : (
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
  const [qtyError, setQtyError] = useState<string | null>(null)

  useEffect(() => setQty(String(line.quantity)), [line.quantity])

  async function commitQuantity() {
    const next = Number(qty)
    if (next === line.quantity) {
      setQtyError(null)
      return
    }
    if (!Number.isFinite(next) || next < 1) {
      setQtyError('Quantity must be a valid number of at least 1.')
      setQty(String(line.quantity))
      return
    }
    setQtyError(null)
    try {
      await lineMutations.update.mutateAsync({ id: line.id, patch: { quantity: next } })
    } catch (e) {
      setQty(String(line.quantity))
      toast(e instanceof Error ? e.message : 'Could not update line item.')
    }
  }

  async function handlePricingChange(next: { pricingLevels: CommercialBoqLineItem['pricingLevels']; activePricingLevel: CommercialBoqLineItem['activePricingLevel'] }) {
    if (!sku) return
    // `line.discountPct` here is only ever a mirror of whichever pricing level was
    // last active (see `resolveLineUnitPrice`'s fallback) — never an independently
    // set flat discount, since every path that fires this handler goes through the
    // Selling Price section. Passing it through as the "current discount" fallback
    // left a stale nonzero discount (and line total) in place after deactivating or
    // removing the level that had produced it; 0 is the correct fallback whenever
    // the new state has no resolved absolute price to derive a discount from.
    const { unitPrice, discountPct } = resolveLineUnitPrice(sku, 0, next.pricingLevels, next.activePricingLevel)
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
        <div>
          <Input
            type="number"
            value={qty}
            onChange={(e) => { setQty(e.target.value); setQtyError(null) }}
            onBlur={commitQuantity}
            onKeyDown={commitOnEnter}
            aria-invalid={!!qtyError}
            className="w-20"
            aria-label="Quantity"
          />
          {qtyError && <p className="mt-1 w-32 text-[11px] text-rose-700">{qtyError}</p>}
        </div>
        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-700">
          {line.activePricingLevel ? PRICING_LEVEL_LABEL[line.activePricingLevel] : 'List Price'}
        </span>
        <span className="text-muted">Sell {line.unitPrice.toLocaleString()}</span>
        <span className="text-muted">{formatPercent(line.discountPct)} off</span>
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
        <span className="text-muted">{formatPercent(line.discountPct)} off</span>
        <span className="text-muted">{line.taxPct}% tax</span>
        <span className="font-medium text-ink-900">{line.lineTotal.toLocaleString()}</span>
      </div>
      {expanded && <LineApprovalSummary line={line} approvalMatrix={approvalMatrix} employees={employees} onDecide={onDecide} />}
    </div>
  )
}

function PreviewTab({ boq, lines, skuById, departmentName, verticalName, salesPerson, open, onOpenChange }: {
  boq: CommercialBoq
  lines: CommercialBoqLineItem[]
  skuById: Map<string, CommercialSku>
  departmentName: string
  verticalName: string
  salesPerson: AvatarPerson | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // The printed proposal stays plain text — only the on-screen preview shows faces.
  const salesPersonName = salesPerson?.name ?? '—'
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
    <Collapsible title="Preview" icon="FileText" open={open} onOpenChange={onOpenChange}>
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
          <DetailField label="Customer" value={personOrDash({ name: boq.customerName })} />
          <DetailField label="Organization" value={boq.customerOrganization} />
          <DetailField label="Department" value={departmentName} />
          <DetailField label="Vertical" value={verticalName} />
          <DetailField label="Sales Person" value={personOrDash(salesPerson)} />
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
                    <td className="px-3 py-2">{formatPercent(line.discountPct)}</td>
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

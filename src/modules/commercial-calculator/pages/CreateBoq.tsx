import { useEffect, useRef, useState } from 'react'
import { useCurrentPostings, useDepartments, useEmployeeMutations, useEmployeesUnder, useSalesPersons } from '@/lib/api'
import { convertWorkAmount, formatBudgetRange, WORK_VALUE_UNITS } from '@/features/nodes/department-meta'
import { EmployeePicker } from '@/features/employees/EmployeePicker'
import { uid } from '@/lib/utils'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Collapsible } from '@/components/ui/Collapsible'
import { Combobox } from '@/components/ui/Combobox'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAllBomItems, useBoqMutations, useBoqs, useMasters, useSkus } from '../api'
import { findBoqByOpportunityName, resolveApprovalBand, skuToBoqConversionFactor, skuTotalUnitCostWithBom } from '../repository-logic'
import { PRICING_LEVEL_LABEL, effectiveUnitPrice, resolveLineUnitPrice } from '../pricing-levels-logic'
import { formatPercent, isNegativeMargin } from '../format'
import { useBoqWorkspaceShortcuts } from '../use-boq-workspace-shortcuts'
import { useStickyScrollOffset } from '../use-sticky-scroll-offset'
import { BOQ_WORKSPACE_SECTIONS, BoqWorkspaceHeader } from '../components/BoqWorkspaceHeader'
import { SkuLinePicker } from '../components/SkuLinePicker'
import { SkuSearchBar } from '../components/SkuSearchBar'
import { SellingPriceSection } from '../components/SellingPriceSection'
import { LineApprovalSummary } from '../components/LineApprovalSummary'
import { BulkEditBar } from '../components/BulkEditBar'
import type { BulkPricingResult } from '../pricing-levels-logic'
import type { ApprovalMatrixRule, CommercialBomItem, CommercialSku, LinePricingLevel, PricingLevelKey } from '../types'
import type { Employee } from '@/lib/types'

interface LineDraft {
  id: string
  skuId: string
  quantity: number
  discountPct: number
  pricingLevels: LinePricingLevel[]
  activePricingLevel: PricingLevelKey | null
}

/** The module's primary journey and, by stakeholder direction (2026-08-03
 *  redesign), the largest page in the module — a guided, section-by-section
 *  proposal workspace, never a modal/wizard dialog. Opportunity -> Customer
 *  -> Commercial Configuration (cascading Vertical -> Product -> Module ->
 *  Feature -> generated SKU, matching split-pane CPQ conventions like
 *  Salesforce/SAP/Dynamics) -> Approval Summary -> BOQ Preview -> Submit.
 *
 *  BOQ workbench QA pass (spec §3): shares the exact same Details / Line
 *  Items / Preview structure, sticky header, compact line rows, Set Selling
 *  Price interaction, and inline (not tabbed) approval that
 *  `ProposalDetail.tsx` uses — a user learns the BOQ interface once. */
export function CreateBoq({ onCancel, onCreated }: { onCancel: () => void; onCreated: (boqId: string) => void }) {
  const { data: departments = [] } = useDepartments()
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const { data: preSalesList = [] } = useMasters('preSales')
  const { data: verticals = [] } = useMasters('verticals')
  const { data: currencies = [] } = useMasters('currencies')
  const { data: taxClasses = [] } = useMasters('taxClasses')
  const { data: approvalMatrix = [] } = useMasters('approvalMatrix')
  const { data: skus = [] } = useSkus()
  const { data: bomItems = [] } = useAllBomItems()
  const { data: boqs = [] } = useBoqs()
  const { create, updateStatus } = useBoqMutations()
  const { create: createEmployee } = useEmployeeMutations()
  const toast = useToast()

  const [opportunityName, setOpportunityName] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetUnit, setBudgetUnit] = useState('lakh')
  const [budgetKnown, setBudgetKnown] = useState('')
  const [emdAmount, setEmdAmount] = useState('')
  const [emdUnit, setEmdUnit] = useState('lakh')
  const [salesPersonId, setSalesPersonId] = useState('')
  const [buSalesPersonId, setBuSalesPersonId] = useState('')
  const [preSalesId, setPreSalesId] = useState('')
  const [verticalId, setVerticalId] = useState('')
  const [currencyCode, setCurrencyCode] = useState('')

  const [customerName, setCustomerName] = useState('')
  const [customerOrganization, setCustomerOrganization] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  // The stakeholder contact is picked from the Department's own real
  // Employee roster (Account Mapping's existing data), not typed from
  // scratch — customerName/Contact/Address are still plain strings on
  // CommercialBoq, just populated from that selection instead of free text.
  const [customerEmployeeId, setCustomerEmployeeId] = useState('')
  // Holds a stakeholder just added inline via the picker's "create new
  // person" flow until `useEmployeesUnder`'s query catches up with it. Kept
  // in both a ref and state: `EmployeePicker`'s `onChange(id)` fires
  // synchronously right after `onCreate` resolves, in the same tick — a
  // `setState` call wouldn't be visible to `handleCustomerEmployeeChange`'s
  // lookup that soon (React hasn't re-rendered yet), so the ref gives that
  // handler a synchronously up-to-date value; the state is what the picker's
  // own `candidates` prop re-renders from on the next render.
  const justCreatedStakeholderRef = useRef<Employee | null>(null)
  const [justCreatedStakeholder, setJustCreatedStakeholder] = useState<Employee | null>(null)
  const { data: employeesUnderDept = [] } = useEmployeesUnder(departmentId || null)
  const stakeholderCandidates = justCreatedStakeholder && !employeesUnderDept.some((e) => e.id === justCreatedStakeholder.id)
    ? [...employeesUnderDept, justCreatedStakeholder]
    : employeesUnderDept

  const [lines, setLines] = useState<LineDraft[]>([])
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null)
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])

  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'draft' | 'submit' | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  function toggleExpandedLine(id: string) {
    setExpandedLineId((prev) => (prev === id ? null : id))
  }
  function moveLine(index: number, direction: 'up' | 'down') {
    setLines((prev) => {
      const swapWith = direction === 'up' ? index - 1 : index + 1
      if (swapWith < 0 || swapWith >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
      return next
    })
  }
  function duplicateLine(index: number) {
    setLines((prev) => [...prev.slice(0, index + 1), { ...prev[index], id: uid('line') }, ...prev.slice(index + 1)])
  }

  const buSalesPersons = salesPersons.filter((p) => (postings[p.id]?.designation ?? '').toLowerCase().includes('bu sales'))
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const taxRateById = new Map(taxClasses.map((t) => [t.id, t.ratePct]))
  const departmentById = new Map(departments.map((d) => [d.id, d]))
  const salesPersonById = new Map(salesPersons.map((p) => [p.id, p]))
  const verticalById = new Map(verticals.map((v) => [v.id, v]))
  const preSalesById = new Map(preSalesList.map((p) => [p.id, p]))
  const existingSkuIds = new Set(lines.map((l) => l.skuId))

  // The proposal's own currency, explicit rather than derived from whichever
  // SKU happens to be added first (P0 fix) — defaults to the configured base
  // currency until the user picks a different one.
  const effectiveCurrencyCode = currencyCode || currencies.find((c) => c.isBaseCurrency)?.code || ''
  function conversionFactorFor(sku: CommercialSku): number {
    if (!effectiveCurrencyCode || currencies.length === 0) return 1
    return skuToBoqConversionFactor(currencies, effectiveCurrencyCode, sku)
  }

  // Department is already the AMNEX record for the government office being
  // sold to — changing it invalidates whatever stakeholder was picked below,
  // the same way changing Vertical resets the Product/Module/Feature picker.
  function handleDepartmentChange(id: string) {
    setDepartmentId(id)
    setCustomerOrganization(departments.find((d) => d.id === id)?.name ?? '')
    setCustomerEmployeeId('')
    setCustomerName('')
    setCustomerContact('')
    setCustomerAddress('')
    justCreatedStakeholderRef.current = null
    setJustCreatedStakeholder(null)
  }
  function handleCustomerEmployeeChange(id: string) {
    setCustomerEmployeeId(id)
    const emp = stakeholderCandidates.find((e) => e.id === id)
      ?? (justCreatedStakeholderRef.current?.id === id ? justCreatedStakeholderRef.current : undefined)
    // A vacant seat (the common case for a government stakeholder AMNEX
    // hasn't yet linked to a named person) has no `name` — its designation
    // ("Director General", "Joint Secretary", ...) is the real, non-invented
    // stakeholder identity, so it becomes the customer name instead.
    setCustomerName(emp ? (emp.vacant ? (emp.designation || 'Vacant position') : emp.name) : '')
    setCustomerContact(emp ? [emp.phone, emp.email].filter(Boolean).join(' · ') : '')
    setCustomerAddress(emp?.address ?? '')
  }
  /** Lets a user record a government stakeholder who isn't yet an `Employee`
   *  (a new contact met for the first time on this tender) without leaving
   *  Create BOQ — same `orgNodeId`/`managerId: null` pattern
   *  `NodeFormDialog.tsx`'s `handleCreateHead` already uses for "create new
   *  department head", scoped to the selected Department. Tracked in
   *  `justCreatedStakeholder` (and merged into the picker's candidates)
   *  because `useEmployeesUnder`'s query invalidation hasn't refetched yet
   *  by the time `EmployeePicker` immediately calls back with the new id —
   *  without this, the customer fields below would momentarily blank out. */
  async function handleCreateStakeholder(name: string, designation: string) {
    const created = await createEmployee.mutateAsync({
      name, designation, email: '', phone: '', orgNodeId: departmentId, managerId: null,
    })
    justCreatedStakeholderRef.current = created
    setJustCreatedStakeholder(created)
    return created.id
  }

  function handleVerticalChange(v: string) {
    setVerticalId(v)
  }

  function removeLine(index: number) {
    setLines((prev) => {
      const removedId = prev[index]?.id
      setSelectedLineIds((ids) => ids.filter((id) => id !== removedId))
      return prev.filter((_, i) => i !== index)
    })
  }
  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function effectivePrice(line: LineDraft, sku: CommercialSku) {
    return resolveLineUnitPrice(sku, line.discountPct, line.pricingLevels, line.activePricingLevel)
  }
  function lineTotal(line: LineDraft): number {
    const sku = skuById.get(line.skuId)
    if (!sku) return 0
    const taxPct = taxRateById.get(sku.taxClassId) ?? 0
    const { unitPrice, discountPct, isAbsolutePrice } = effectivePrice(line, sku)
    return line.quantity * effectiveUnitPrice(unitPrice, discountPct, isAbsolutePrice) * (1 + taxPct / 100) * conversionFactorFor(sku)
  }
  const grandTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0)
  const revenuePreTax = lines.reduce((sum, l) => {
    const sku = skuById.get(l.skuId)
    if (!sku) return sum
    const { unitPrice, discountPct, isAbsolutePrice } = effectivePrice(l, sku)
    return sum + l.quantity * effectiveUnitPrice(unitPrice, discountPct, isAbsolutePrice) * conversionFactorFor(sku)
  }, 0)
  const totalCost = lines.reduce((sum, l) => {
    const sku = skuById.get(l.skuId)
    if (!sku) return sum
    return sum + l.quantity * skuTotalUnitCostWithBom(sku, bomItems, skuById) * conversionFactorFor(sku)
  }, 0)
  const marginPreview = revenuePreTax === 0 ? 0 : ((revenuePreTax - totalCost) / revenuePreTax) * 100

  const approvalPreview = lines.map((l) => {
    const sku = skuById.get(l.skuId)
    const { discountPct } = sku ? effectivePrice(l, sku) : { discountPct: l.discountPct }
    const band = resolveApprovalBand(approvalMatrix, discountPct)
    return { line: l, sku, band, discountPct }
  })
  const pendingApprovalLines = approvalPreview.filter((p) => !p.band.allowAutoApproval)

  const opportunityNameClash = findBoqByOpportunityName(boqs, opportunityName, null)

  // Save/Submit stay disabled until every one of these is met, but a
  // disabled button alone tells the user nothing — surfaced as a checklist
  // next to the buttons so "why can't I submit" always has a visible answer.
  const missingRequirements = [
    !opportunityName.trim() && 'Opportunity Name',
    opportunityNameClash && `a unique Opportunity Name (already used by ${opportunityNameClash.boqNumber})`,
    !departmentId && 'Department',
    !customerName.trim() && 'a confirmed Stakeholder Contact — select one from the list or finish adding a new one',
    !verticalId && 'Vertical',
    !salesPersonId && 'Sales Person',
    lines.length === 0 && 'at least one SKU line',
  ].filter((v): v is string => typeof v === 'string')
  const canSave = missingRequirements.length === 0

  async function save(thenSubmit: boolean) {
    setPending(thenSubmit ? 'submit' : 'draft')
    setError(null)
    try {
      const { boq } = await create.mutateAsync({
        input: {
          opportunityName, departmentId, customerName, customerOrganization, customerAddress,
          customerContact, verticalId, budgetAmount, budgetUnit, budgetKnown, emdAmount, emdUnit, salesPersonId,
          buSalesPersonId: buSalesPersonId || null, preSalesId: preSalesId || null, currency: effectiveCurrencyCode,
        },
        lines: lines.map((l) => {
          const sku = skuById.get(l.skuId)!
          const { unitPrice, discountPct } = resolveLineUnitPrice(sku, l.discountPct, l.pricingLevels, l.activePricingLevel)
          return { skuId: l.skuId, quantity: l.quantity, discountPct, unitPrice, pricingLevels: l.pricingLevels, activePricingLevel: l.activePricingLevel }
        }),
      })
      if (thenSubmit) {
        await updateStatus.mutateAsync({ id: boq.id, nextStatus: 'submitted', changeReason: 'Submitted at creation' })
      }
      toast(`BOQ ${boq.boqNumber} ${thenSubmit ? 'submitted' : 'saved as draft'}.`)
      onCreated(boq.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save BOQ.')
    } finally {
      setPending(null)
    }
  }

  function applyBulkResults(results: BulkPricingResult[]) {
    const failed = results.filter((r) => !r.ok)
    setLines((prev) => prev.map((l) => {
      const r = results.find((res) => res.lineId === l.id && res.ok)
      if (!r) return l
      return {
        ...l,
        ...(r.quantity !== undefined ? { quantity: r.quantity } : {}),
        ...(r.discountPct !== undefined ? { discountPct: r.discountPct } : {}),
        ...(r.pricingLevels !== undefined ? { pricingLevels: r.pricingLevels } : {}),
        ...(r.activePricingLevel !== undefined ? { activePricingLevel: r.activePricingLevel } : {}),
      }
    }))
    if (failed.length > 0) {
      toast(`${failed.length} line(s) could not be updated: ${failed.map((f) => f.error).join('; ')}`)
    } else {
      toast('Bulk update applied.')
    }
    setSelectedLineIds([])
  }

  function toggleOneSelected(id: string) {
    setSelectedLineIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }
  function toggleAllSelected() {
    setSelectedLineIds((prev) => (prev.length === lines.length ? [] : lines.map((l) => l.id)))
  }
  const selectedLines = lines.filter((l) => selectedLineIds.includes(l.id))

  useBoqWorkspaceShortcuts({
    onSave: () => { if (canSave && pending === null) save(false) },
    onEscape: () => { if (expandedLineId !== null) setExpandedLineId(null) },
  })

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickyBarRef = useRef<HTMLDivElement>(null)
  useStickyScrollOffset(scrollContainerRef, stickyBarRef)

  return (
    <div ref={scrollContainerRef} className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 border-b border-line bg-white px-4 py-3">
        <h1 className="font-display text-lg font-semibold text-ink-900">Create BOQ</h1>
        <p className="text-[12px] text-muted">Configure the commercial proposal, then save as draft or submit for review.</p>
      </div>

      {/* Both bars pin together as one unit — stacking two independent
         `sticky top-0` elements would land them on the same coordinate once
         both are stuck, hiding whichever has the lower z-index behind the
         other and silently swallowing clicks meant for it. */}
      <div ref={stickyBarRef} className="sticky top-0 z-20 flex flex-col">
      <BoqWorkspaceHeader
        boqNumber={null}
        statusLabel="Draft"
        customerName={customerName}
        lineCount={lines.length}
        marginPct={marginPreview}
        grandTotal={grandTotal}
        currencyCode={effectiveCurrencyCode}
        onPreview={() => {
          setPreviewOpen(true)
          document.getElementById('section-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        saveDraft={{ onClick: () => save(false), label: pending === 'draft' ? 'Saving…' : 'Save Draft', disabled: pending !== null || !canSave }}
        submit={{ onClick: () => save(true), label: pending === 'submit' ? 'Submitting…' : 'Submit', disabled: pending !== null || !canSave }}
      />

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-white/95 px-4 py-1.5 backdrop-blur">
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
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

        <div id="section-details">
        <Collapsible title="BOQ Details" icon="Briefcase">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Field label="Opportunity Name" hint="Must be unique across all BOQs.">
              <Input value={opportunityName} onChange={(e) => setOpportunityName(e.target.value)} />
              {opportunityNameClash && (
                <p className="mt-1 text-[12px] text-rose-700">Already used by {opportunityNameClash.boqNumber}. Choose a different name.</p>
              )}
            </Field>
            <Field label="Department">
              <Combobox
                value={departmentId}
                onChange={handleDepartmentChange}
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
                aria-label="Department"
              />
            </Field>
            <Field label="Vertical" hint="Drives the SKU picker below.">
              <Combobox
                value={verticalId}
                onChange={handleVerticalChange}
                options={verticals.map((v) => ({ value: v.id, label: `${v.code} — ${v.name}` }))}
                aria-label="Vertical"
              />
            </Field>
            <Field label="Proposal Currency" hint="Every line is converted into this currency.">
              <Select value={effectiveCurrencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
                {currencies.map((c) => <option key={c.id} value={c.code}>{c.code} — {c.name}</option>)}
              </Select>
            </Field>
            <div className="col-span-2 lg:col-span-3">
              <Field label="Budget Confirmed?">
                <div className="flex items-center gap-4" role="radiogroup" aria-label="Budget confirmed">
                  {(['yes', 'no'] as const).map((v) => (
                    <label key={v} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="budgetKnown"
                        checked={budgetKnown === v}
                        onChange={() => setBudgetKnown(v)}
                        className="accent-ink-900"
                      />
                      <span className="text-sm text-ink-800">{v === 'yes' ? 'Yes' : 'No'}</span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <div className="col-span-2 lg:col-span-3">
              {/* Same mutual-exclusivity as Account Mapping's Opportunity form
                  (WorkFormDialog.tsx): either the budget is confirmed and
                  entered directly, or — not both — it's left blank here and
                  estimated from the EMD amount below. */}
              <Field label="Budget Amount" hint={budgetKnown === 'no' ? "Disabled while the budget isn't confirmed — use the EMD fields below instead." : undefined}>
                <div className="flex gap-2">
                  <Input
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    disabled={budgetKnown === 'no'}
                    className="flex-1 disabled:cursor-not-allowed disabled:bg-panel disabled:text-muted"
                  />
                  <Select
                    value={budgetUnit}
                    onChange={(e) => {
                      const next = e.target.value
                      setBudgetAmount(convertWorkAmount(budgetAmount, budgetUnit, next))
                      setBudgetUnit(next)
                    }}
                    disabled={budgetKnown === 'no'}
                    className="w-28 shrink-0 disabled:cursor-not-allowed disabled:bg-panel disabled:text-muted"
                  >
                    {WORK_VALUE_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </Select>
                </div>
              </Field>
            </div>
            {budgetKnown === 'no' && (
              <div className="col-span-2 grid grid-cols-1 gap-4 rounded-xl border border-line bg-panel/40 p-4 sm:grid-cols-2 lg:col-span-3">
                <Field label="EMD Amount" hint="Used to derive an estimated budget range below">
                  <div className="flex gap-2">
                    <Input
                      value={emdAmount}
                      onChange={(e) => setEmdAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      className="flex-1"
                    />
                    <Select
                      value={emdUnit}
                      onChange={(e) => {
                        const next = e.target.value
                        setEmdAmount(convertWorkAmount(emdAmount, emdUnit, next))
                        setEmdUnit(next)
                      }}
                      className="w-28 shrink-0"
                    >
                      {WORK_VALUE_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                    </Select>
                  </div>
                </Field>
                {formatBudgetRange({ emdAmount, emdUnit }) && (
                  <Field label="Budget (derived)">
                    <p className="flex h-10 items-center rounded-lg border border-line bg-panel px-3 text-sm text-ink-700">
                      {formatBudgetRange({ emdAmount, emdUnit })}
                    </p>
                  </Field>
                )}
              </div>
            )}
            <Field label="Sales Person">
              <Combobox
                value={salesPersonId}
                onChange={setSalesPersonId}
                options={salesPersons.map((p) => ({ value: p.id, label: p.name }))}
                aria-label="Sales Person"
              />
            </Field>
            <Field label="Pre-Sales">
              <Select value={preSalesId} onChange={(e) => setPreSalesId(e.target.value)}>
                <option value="">None</option>
                {preSalesList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="BU Sales" hint="Filtered to Sales Persons with a &quot;BU Sales&quot; posting.">
              <Select value={buSalesPersonId} onChange={(e) => setBuSalesPersonId(e.target.value)}>
                <option value="">None</option>
                {buSalesPersons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Field
              label="Stakeholder Contact"
              hint={
                !departmentId
                  ? 'Select a Department above first.'
                  : stakeholderCandidates.length === 0
                    ? 'No stakeholders found under this department yet — type a name below to add one.'
                    : 'Reuses AMNEX’s existing stakeholder contacts (including unfilled positions) for this department — type a name to add someone new.'
              }
            >
              <EmployeePicker
                candidates={stakeholderCandidates}
                value={customerEmployeeId}
                onChange={handleCustomerEmployeeChange}
                placeholder="Search a stakeholder…"
                emptyLabel="— None selected —"
                includeVacant
                onCreate={departmentId ? handleCreateStakeholder : undefined}
                createLabel={(name) => `Add new stakeholder “${name}”`}
                unconfirmedHint="This name hasn't been selected or added yet — pick a match from the list, or finish “Add new stakeholder”. Typed text alone won't be saved."
              />
            </Field>
            <Field label="Organization"><Input value={customerOrganization} onChange={(e) => setCustomerOrganization(e.target.value)} /></Field>
            <Field label="Contact"><Input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} /></Field>
            <div className="col-span-2 lg:col-span-3">
              <Field label="Address"><Textarea value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} /></Field>
            </div>
          </div>
        </Collapsible>
        </div>

        <div id="section-lines">
        <Collapsible
          title="Line Items"
          icon="Boxes"
          badge={pendingApprovalLines.length > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{pendingApprovalLines.length} pending</span> : undefined}
        >
          {!verticalId ? (
            <p className="text-[13px] text-muted">Select a Vertical above to start configuring this proposal.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <SkuSearchBar
                key={`search-${verticalId}`}
                verticalId={verticalId}
                currencyCode={effectiveCurrencyCode}
                bomItems={bomItems}
                existingSkuIds={existingSkuIds}
                onAdd={(line) => setLines((prev) => [...prev, { ...line, id: uid('line') }])}
              />
              <Collapsible title="Browse Catalog" icon="Boxes" defaultOpen={false}>
                <SkuLinePicker
                  key={`browse-${verticalId}`}
                  verticalId={verticalId}
                  currencyCode={effectiveCurrencyCode}
                  bomItems={bomItems}
                  existingSkuIds={existingSkuIds}
                  onAdd={(line) => setLines((prev) => [...prev, { ...line, id: uid('line') }])}
                />
              </Collapsible>
            </div>
          )}

          {lines.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <Checkbox checked={selectedLineIds.length === lines.length} indeterminate={selectedLineIds.length > 0 && selectedLineIds.length < lines.length} onChange={toggleAllSelected} aria-label="Select all lines" />
              <span className="text-[12px] text-muted">Select all</span>
            </div>
          )}
          {selectedLines.length > 0 && (
            <div className="mt-2">
              <BulkEditBar selectedLines={selectedLines} skusById={skuById} onApply={applyBulkResults} />
            </div>
          )}

          {lines.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">No SKUs added yet — configure one above to start building the proposal.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {lines.map((line, i) => {
                const sku = skuById.get(line.skuId)
                return (
                  <div key={line.id} className="flex items-start gap-2">
                    <Checkbox
                      checked={selectedLineIds.includes(line.id)}
                      onChange={() => toggleOneSelected(line.id)}
                      aria-label={`Select ${sku?.skuCode ?? 'line'}`}
                    />
                    <div className="flex-1">
                      <ConfiguredLineRow
                        line={line}
                        sku={sku}
                        bomItems={bomItems}
                        skuById={skuById}
                        approvalMatrix={approvalMatrix}
                        lineTotal={lineTotal(line)}
                        taxRateById={taxRateById}
                        onUpdate={(patch) => updateLine(i, patch)}
                        onRemove={() => removeLine(i)}
                        expanded={expandedLineId === line.id}
                        onToggleExpand={() => toggleExpandedLine(line.id)}
                        isFirst={i === 0}
                        isLast={i === lines.length - 1}
                        onMoveUp={() => moveLine(i, 'up')}
                        onMoveDown={() => moveLine(i, 'down')}
                        onDuplicate={() => duplicateLine(i)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Collapsible>
        </div>

        <div id="section-preview">
        <Collapsible title="Preview" icon="FileText" open={previewOpen} onOpenChange={setPreviewOpen}>
          {lines.length === 0 ? (
            <p className="text-[13px] text-muted">The full proposal preview appears once at least one line is configured.</p>
          ) : (
            <div className="flex flex-col gap-4 text-[13px]">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <DetailField label="Opportunity" value={opportunityName || '—'} />
                <DetailField label="Department" value={departmentById.get(departmentId)?.name ?? '—'} />
                <DetailField label="Vertical" value={verticalById.get(verticalId)?.name ?? '—'} />
                <DetailField label="Customer" value={customerName || '—'} />
                <DetailField label="Sales Person" value={salesPersonById.get(salesPersonId)?.name ?? '—'} />
                <DetailField label="Pre-Sales" value={preSalesById.get(preSalesId)?.name ?? '—'} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-[12px]">
                  <thead className="border-b border-line bg-panel/60 text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">SKU</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
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
                          <td className="px-3 py-2">{formatPercent(sku ? effectivePrice(line, sku).discountPct : line.discountPct)}</td>
                          <td className="px-3 py-2">{taxRateById.get(sku?.taxClassId ?? '') ?? 0}%</td>
                          <td className="px-3 py-2 text-right font-medium text-ink-900">{lineTotal(line).toLocaleString()}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-4 text-sm">
                <span className={isNegativeMargin(marginPreview) ? 'font-medium text-rose-700' : 'text-muted'}>
                  Margin {formatPercent(marginPreview)}{isNegativeMargin(marginPreview) ? ' — Below Cost' : ''}
                </span>
                <span className="font-semibold text-ink-900">
                  Grand Total: {effectiveCurrencyCode} {grandTotal.toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </Collapsible>
        </div>

        <div className="flex flex-col items-end gap-1.5 border-t border-line pt-4">
          <Button onClick={onCancel} disabled={pending !== null}>Cancel</Button>
          {missingRequirements.length > 0 && (
            <p className="text-[11px] text-muted">Missing: {missingRequirements.join(', ')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** An already-added line, editable in place (quantity + pricing levels) so
 *  fixing a line never requires deleting and re-adding it. Mirrors
 *  `ProposalDetail.tsx`'s `DraftLineRow`, but mutates local `lines` state
 *  directly instead of issuing a mutation, since nothing here is persisted
 *  until the BOQ itself is saved. Selling Price is always visible, exactly
 *  like `DraftLineRow` — the row's own expand/collapse only gates the
 *  approval-band preview, not pricing (BOQ workbench QA pass §3). */
function ConfiguredLineRow({
  line, sku, bomItems, skuById, approvalMatrix, lineTotal, taxRateById, onUpdate, onRemove,
  expanded, onToggleExpand, isFirst, isLast, onMoveUp, onMoveDown, onDuplicate,
}: {
  line: LineDraft
  sku: CommercialSku | undefined
  bomItems: CommercialBomItem[]
  skuById: Map<string, CommercialSku>
  approvalMatrix: ApprovalMatrixRule[]
  lineTotal: number
  taxRateById: Map<string, number>
  onUpdate: (patch: Partial<LineDraft>) => void
  onRemove: () => void
  expanded: boolean
  onToggleExpand: () => void
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
}) {
  const [qty, setQty] = useState(String(line.quantity))
  const [qtyError, setQtyError] = useState<string | null>(null)

  useEffect(() => setQty(String(line.quantity)), [line.quantity])

  function commitQuantity() {
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
    onUpdate({ quantity: next })
  }

  function commitOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const { unitPrice, discountPct } = sku
    ? resolveLineUnitPrice(sku, line.discountPct, line.pricingLevels, line.activePricingLevel)
    : { unitPrice: 0, discountPct: line.discountPct }
  const taxPct = sku ? taxRateById.get(sku.taxClassId) ?? 0 : 0

  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5 text-[13px]">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onToggleExpand} aria-label="Toggle approval summary" className="text-muted">
          <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size={14} />
        </button>
        <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{sku?.skuCode}</span>
        <span className="min-w-0 flex-1 truncate">{sku?.name}</span>
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
        <span className="text-muted">Sell {unitPrice.toLocaleString()}</span>
        <span className="text-muted">{formatPercent(discountPct)} off</span>
        <span className="text-muted">{taxPct}% tax</span>
        <span className="font-medium text-ink-900">{lineTotal.toLocaleString()}</span>
        <Button size="icon" onClick={onMoveUp} disabled={isFirst} title="Move up" aria-label="Move up"><Icon name="ArrowUp" size={14} /></Button>
        <Button size="icon" onClick={onMoveDown} disabled={isLast} title="Move down" aria-label="Move down"><Icon name="ArrowDown" size={14} /></Button>
        <Button size="icon" onClick={onDuplicate} title="Duplicate line" aria-label="Duplicate line"><Icon name="Copy" size={14} /></Button>
        <Button size="icon" onClick={onRemove} title="Remove"><Icon name="Trash2" size={14} /></Button>
      </div>
      {sku && (
        <div className="mt-2 border-t border-line pt-2">
          <SellingPriceSection
            sku={sku}
            bomItems={bomItems}
            skusById={skuById}
            pricingLevels={line.pricingLevels}
            activePricingLevel={line.activePricingLevel}
            onChange={(next) => onUpdate(next)}
          />
        </div>
      )}
      {expanded && (
        <LineApprovalSummary
          line={{ id: line.id, discountPct, approvalStatus: 'pending', approvalDate: null, approvalRemarks: '' }}
          approvalMatrix={approvalMatrix}
        />
      )}
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[13px] text-ink-900">{value}</div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { useCurrentPostings, useDepartments, useEmployeeMutations, useEmployeesUnder, useSalesPersons } from '@/lib/api'
import { convertWorkAmount, formatBudgetRange, WORK_VALUE_UNITS } from '@/features/nodes/department-meta'
import { EmployeePicker } from '@/features/employees/EmployeePicker'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAllBomItems, useBoqMutations, useMasters, useSkus } from '../api'
import { resolveApprovalBand, skuToBoqConversionFactor, skuTotalUnitCostWithBom } from '../repository-logic'
import type { CommercialSku } from '../types'
import type { Employee } from '@/lib/types'

interface LineDraft {
  skuId: string
  quantity: number
  discountPct: number
}

/** The module's primary journey and, by stakeholder direction (2026-08-03
 *  redesign), the largest page in the module — a guided, section-by-section
 *  proposal workspace, never a modal/wizard dialog. Opportunity -> Customer
 *  -> Commercial Configuration (cascading Vertical -> Product -> Module ->
 *  Feature -> generated SKU, matching split-pane CPQ conventions like
 *  Salesforce/SAP/Dynamics) -> Approval Summary -> BOQ Preview -> Submit. */
export function CreateBoq({ onCancel, onCreated }: { onCancel: () => void; onCreated: (boqId: string) => void }) {
  const { data: departments = [] } = useDepartments()
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const { data: preSalesList = [] } = useMasters('preSales')
  const { data: verticals = [] } = useMasters('verticals')
  const { data: products = [] } = useMasters('products')
  const { data: modules = [] } = useMasters('modules')
  const { data: features = [] } = useMasters('features')
  const { data: currencies = [] } = useMasters('currencies')
  const { data: taxClasses = [] } = useMasters('taxClasses')
  const { data: approvalMatrix = [] } = useMasters('approvalMatrix')
  const { data: skus = [] } = useSkus()
  const { data: bomItems = [] } = useAllBomItems()
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
  const [customerGst, setCustomerGst] = useState('')
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
  // Cascading Commercial Configuration picker — Vertical is the BOQ's own
  // field above; Product/Module/Feature narrow down to the single SKU that
  // feature's code generation produces (spec: one feature -> at most one
  // non-duplicate SKU code).
  const [pickerProductId, setPickerProductId] = useState('')
  const [pickerModuleId, setPickerModuleId] = useState('')
  const [pickerFeatureId, setPickerFeatureId] = useState('')
  const [pickerQty, setPickerQty] = useState(1)
  const [pickerDiscount, setPickerDiscount] = useState(0)

  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'draft' | 'submit' | null>(null)

  const buSalesPersons = salesPersons.filter((p) => (postings[p.id]?.designation ?? '').toLowerCase().includes('bu sales'))
  const sellableSkus = skus.filter((s) => s.lifecycleStatus === 'active' && s.isSellable)
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const taxRateById = new Map(taxClasses.map((t) => [t.id, t.ratePct]))
  const departmentById = new Map(departments.map((d) => [d.id, d]))
  const salesPersonById = new Map(salesPersons.map((p) => [p.id, p]))
  const verticalById = new Map(verticals.map((v) => [v.id, v]))
  const preSalesById = new Map(preSalesList.map((p) => [p.id, p]))

  const pickerProducts = products.filter((p) => p.verticalId === verticalId)
  const pickerModules = modules.filter((m) => m.productId === pickerProductId)
  const pickerFeatures = features.filter((f) => f.moduleId === pickerModuleId)
  const resolvedSku = pickerFeatureId ? sellableSkus.find((s) => s.featureId === pickerFeatureId) : undefined
  const featureHasNoSellableSku = !!pickerFeatureId && !resolvedSku

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
    setPickerProductId('')
    setPickerModuleId('')
    setPickerFeatureId('')
  }
  function handleProductChange(v: string) {
    setPickerProductId(v)
    setPickerModuleId('')
    setPickerFeatureId('')
  }
  function handleModuleChange(v: string) {
    setPickerModuleId(v)
    setPickerFeatureId('')
  }

  function addLine() {
    if (!resolvedSku) return
    setLines((prev) => [...prev, { skuId: resolvedSku.id, quantity: pickerQty, discountPct: pickerDiscount }])
    setPickerProductId('')
    setPickerModuleId('')
    setPickerFeatureId('')
    setPickerQty(1)
    setPickerDiscount(0)
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  function lineTotal(line: LineDraft): number {
    const sku = skuById.get(line.skuId)
    if (!sku) return 0
    const taxPct = taxRateById.get(sku.taxClassId) ?? 0
    return line.quantity * sku.listPrice * (1 - line.discountPct / 100) * (1 + taxPct / 100) * conversionFactorFor(sku)
  }
  const grandTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0)
  const revenuePreTax = lines.reduce((sum, l) => {
    const sku = skuById.get(l.skuId)
    return sku ? sum + l.quantity * sku.listPrice * (1 - l.discountPct / 100) * conversionFactorFor(sku) : sum
  }, 0)
  const totalCost = lines.reduce((sum, l) => {
    const sku = skuById.get(l.skuId)
    if (!sku) return sum
    return sum + l.quantity * skuTotalUnitCostWithBom(sku, bomItems, skuById) * conversionFactorFor(sku)
  }, 0)
  const marginPreview = revenuePreTax === 0 ? 0 : ((revenuePreTax - totalCost) / revenuePreTax) * 100
  const totalTax = lines.reduce((sum, l) => {
    const sku = skuById.get(l.skuId)
    if (!sku) return sum
    const taxPct = taxRateById.get(sku.taxClassId) ?? 0
    return sum + l.quantity * sku.listPrice * (1 - l.discountPct / 100) * (taxPct / 100) * conversionFactorFor(sku)
  }, 0)

  const approvalPreview = lines.map((l) => {
    const band = resolveApprovalBand(approvalMatrix, l.discountPct)
    return { line: l, sku: skuById.get(l.skuId), band }
  })
  const autoApprovedCount = approvalPreview.filter((p) => p.band.allowAutoApproval).length
  const pendingApprovalLines = approvalPreview.filter((p) => !p.band.allowAutoApproval)

  // Save/Submit stay disabled until every one of these is met, but a
  // disabled button alone tells the user nothing — surfaced as a checklist
  // next to the buttons so "why can't I submit" always has a visible answer.
  const missingRequirements = [
    !opportunityName.trim() && 'Opportunity Name',
    !departmentId && 'Department',
    !customerName.trim() && 'Stakeholder Contact',
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
          opportunityName, departmentId, customerName, customerOrganization, customerAddress, customerGst,
          customerContact, verticalId, budgetAmount, budgetUnit, budgetKnown, emdAmount, emdUnit, salesPersonId,
          buSalesPersonId: buSalesPersonId || null, preSalesId: preSalesId || null, currency: effectiveCurrencyCode,
        },
        lines: lines.map((l) => ({
          skuId: l.skuId, quantity: l.quantity, discountPct: l.discountPct, unitPrice: skuById.get(l.skuId)!.listPrice,
        })),
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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 border-b border-line bg-white px-4 py-3">
        <h1 className="font-display text-lg font-semibold text-ink-900">Create BOQ</h1>
        <p className="text-[12px] text-muted">Configure the commercial proposal, then save as draft or submit for review.</p>
      </div>

      <div className="flex flex-col gap-6 p-4">
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

        <SectionCard title="Opportunity Information" icon="Briefcase">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Field label="Opportunity Name" hint="Must be unique across all BOQs.">
              <Input value={opportunityName} onChange={(e) => setOpportunityName(e.target.value)} />
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
        </SectionCard>

        <SectionCard title="Customer Information" icon="Building2">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
              />
            </Field>
            <Field label="Organization"><Input value={customerOrganization} onChange={(e) => setCustomerOrganization(e.target.value)} /></Field>
            <Field label="GST"><Input value={customerGst} onChange={(e) => setCustomerGst(e.target.value)} /></Field>
            <Field label="Contact"><Input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} /></Field>
            <div className="col-span-2 lg:col-span-3">
              <Field label="Address"><Textarea value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} /></Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Commercial Configuration" icon="Boxes">
          {!verticalId ? (
            <p className="text-[13px] text-muted">Select a Vertical above to start configuring this proposal.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-panel/40 p-3">
              <Field label="Product">
                <Combobox
                  value={pickerProductId}
                  onChange={handleProductChange}
                  options={pickerProducts.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
                  className="min-w-[180px]"
                  aria-label="Product"
                />
              </Field>
              <Field label="Module">
                <Combobox
                  value={pickerModuleId}
                  onChange={handleModuleChange}
                  options={pickerModules.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))}
                  className="min-w-[180px]"
                  disabled={!pickerProductId}
                  aria-label="Module"
                />
              </Field>
              <Field label="Feature">
                <Combobox
                  value={pickerFeatureId}
                  onChange={setPickerFeatureId}
                  options={pickerFeatures.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }))}
                  className="min-w-[180px]"
                  disabled={!pickerModuleId}
                  aria-label="Feature"
                />
              </Field>
              <Field label="Quantity"><Input type="number" value={pickerQty} onChange={(e) => setPickerQty(Number(e.target.value))} className="w-24" /></Field>
              <Field label="Discount %">
                <Input
                  type="number"
                  value={pickerDiscount}
                  onChange={(e) => setPickerDiscount(Math.min(90, Math.max(0, Number(e.target.value))))}
                  className="w-24"
                />
              </Field>
              <Button variant="primary" size="sm" onClick={addLine} disabled={!resolvedSku}>
                <Icon name="Plus" size={14} />
                Add to Proposal
              </Button>
            </div>
          )}

          {resolvedSku && (
            <>
              <p className="mt-2 text-[12px] text-muted">
                Generated SKU: <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{resolvedSku.skuCode}</span>
                {' '}— {resolvedSku.name}
              </p>
              {/* Pricing preview — shows what "Add to Proposal" would commit,
                  computed with the same lineTotal() the added line row uses,
                  so there's never a discrepancy between preview and line. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-line bg-panel/40 px-3 py-2 text-[12px]">
                <span className="text-muted">List Price <span className="font-medium text-ink-900">{resolvedSku.listPrice.toLocaleString()}</span></span>
                <span className="text-muted">Post-discount Unit <span className="font-medium text-ink-900">{(resolvedSku.listPrice * (1 - pickerDiscount / 100)).toLocaleString()}</span></span>
                <span className="text-muted">Tax <span className="font-medium text-ink-900">{taxRateById.get(resolvedSku.taxClassId) ?? 0}%</span></span>
                <span className="text-muted">
                  Line Total (Qty {pickerQty}){' '}
                  <span className="font-semibold text-ink-900">
                    {lineTotal({ skuId: resolvedSku.id, quantity: pickerQty, discountPct: pickerDiscount }).toLocaleString()}
                  </span>
                </span>
              </div>
            </>
          )}
          {featureHasNoSellableSku && (
            <p className="mt-2 text-[12px] text-amber-700">No active, sellable SKU exists for this feature yet.</p>
          )}

          {lines.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">No SKUs added yet — configure one above to start building the proposal.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {lines.map((line, i) => {
                const sku = skuById.get(line.skuId)
                return (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-[13px]">
                    <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{sku?.skuCode}</span>
                    <span className="min-w-0 flex-1 truncate">{sku?.name}</span>
                    <span className="text-muted">Qty {line.quantity}</span>
                    <span className="text-muted">{line.discountPct}% off</span>
                    <span className="font-medium text-ink-900">{lineTotal(line).toLocaleString()}</span>
                    <Button size="icon" onClick={() => removeLine(i)} title="Remove"><Icon name="Trash2" size={14} /></Button>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Pricing Summary" icon="FileSpreadsheet">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryStat label="Taxes" value={totalTax.toLocaleString()} />
            <SummaryStat label="Margin" value={`${marginPreview.toFixed(1)}%`} />
            <SummaryStat label="Line Items" value={String(lines.length)} />
            <SummaryStat label="Grand Total" value={`${effectiveCurrencyCode} ${grandTotal.toLocaleString()}`} emphasis />
          </div>
        </SectionCard>

        <SectionCard title="Approval Summary" icon="Check">
          {lines.length === 0 ? (
            <p className="text-[13px] text-muted">Add lines above to see which will need manual approval.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-4 text-[13px]">
                <span className="text-emerald-700">{autoApprovedCount} line(s) auto-approved</span>
                <span className="text-amber-700">{pendingApprovalLines.length} line(s) require manual approval</span>
              </div>
              {pendingApprovalLines.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {pendingApprovalLines.map(({ line, sku, band }, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      <span className="font-mono">{sku?.skuCode}</span>
                      <span>{line.discountPct}% discount</span>
                      <span className="ml-auto font-medium">{band.approvalLevelLabel || band.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard title="BOQ Preview" icon="FileText">
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
                    {lines.map((line, i) => {
                      const sku = skuById.get(line.skuId)
                      return (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="px-3 py-2">
                            <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{sku?.skuCode}</span>
                            <span className="ml-2">{sku?.name}</span>
                          </td>
                          <td className="px-3 py-2">{line.quantity}</td>
                          <td className="px-3 py-2">{line.discountPct}%</td>
                          <td className="px-3 py-2">{taxRateById.get(sku?.taxClassId ?? '') ?? 0}%</td>
                          <td className="px-3 py-2 text-right font-medium text-ink-900">{lineTotal(line).toLocaleString()}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end text-sm font-semibold text-ink-900">
                Grand Total: {effectiveCurrencyCode} {grandTotal.toLocaleString()}
              </div>
            </div>
          )}
        </SectionCard>

        <div className="flex flex-col items-end gap-1.5 border-t border-line pt-4">
          <div className="flex gap-2">
            <Button onClick={onCancel} disabled={pending !== null}>Cancel</Button>
            <Button onClick={() => save(false)} disabled={pending !== null || !canSave}>
              {pending === 'draft' ? 'Saving…' : 'Save Draft'}
            </Button>
            <Button variant="primary" onClick={() => save(true)} disabled={pending !== null || !canSave}>
              {pending === 'submit' ? 'Submitting…' : 'Save & Submit'}
            </Button>
          </div>
          {missingRequirements.length > 0 && (
            <p className="text-[11px] text-muted">Missing: {missingRequirements.join(', ')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon name={icon} size={16} className="text-ink-700" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-800">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function SummaryStat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={emphasis ? 'text-xl font-semibold text-ink-900' : 'text-base font-medium text-ink-900'}>{value}</div>
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

import { useState } from 'react'
import { useCurrentPostings, useDepartments, useSalesPersons } from '@/lib/api'
import { convertWorkAmount, formatBudgetRange, WORK_VALUE_UNITS } from '@/features/nodes/department-meta'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useBoqMutations, useMasters, useSkus } from '../api'
import { resolveApprovalBand } from '../repository-logic'

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
  const { create, updateStatus } = useBoqMutations()
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

  const [customerName, setCustomerName] = useState('')
  const [customerOrganization, setCustomerOrganization] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerGst, setCustomerGst] = useState('')
  const [customerContact, setCustomerContact] = useState('')

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
    return line.quantity * sku.listPrice * (1 - line.discountPct / 100) * (1 + taxPct / 100)
  }
  const grandTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0)
  const revenuePreTax = lines.reduce((sum, l) => {
    const sku = skuById.get(l.skuId)
    return sku ? sum + l.quantity * sku.listPrice * (1 - l.discountPct / 100) : sum
  }, 0)
  const totalCost = lines.reduce((sum, l) => {
    const sku = skuById.get(l.skuId)
    if (!sku) return sum
    return sum + l.quantity * (
      sku.baseSoftwareCost + sku.implementationCostPerMM + sku.integrationCost + sku.thirdPartyCost
      + sku.hardwareCost + sku.cloudCost + sku.supportCost + sku.trainingCost
    )
  }, 0)
  const marginPreview = revenuePreTax === 0 ? 0 : ((revenuePreTax - totalCost) / revenuePreTax) * 100
  const totalTax = lines.reduce((sum, l) => {
    const sku = skuById.get(l.skuId)
    if (!sku) return sum
    const taxPct = taxRateById.get(sku.taxClassId) ?? 0
    return sum + l.quantity * sku.listPrice * (1 - l.discountPct / 100) * (taxPct / 100)
  }, 0)

  const approvalPreview = lines.map((l) => {
    const band = resolveApprovalBand(approvalMatrix, l.discountPct)
    return { line: l, sku: skuById.get(l.skuId), band }
  })
  const autoApprovedCount = approvalPreview.filter((p) => p.band.allowAutoApproval).length
  const pendingApprovalLines = approvalPreview.filter((p) => !p.band.allowAutoApproval)

  const canSave = opportunityName.trim().length > 0 && departmentId && customerName.trim().length > 0
    && verticalId && salesPersonId && lines.length > 0

  async function save(thenSubmit: boolean) {
    setPending(thenSubmit ? 'submit' : 'draft')
    setError(null)
    try {
      const firstSku = skuById.get(lines[0]?.skuId ?? '')
      const currency = currencies.find((c) => c.id === firstSku?.currencyId)?.code
        ?? currencies.find((c) => c.isBaseCurrency)?.code ?? 'INR'

      const { boq } = await create.mutateAsync({
        input: {
          opportunityName, departmentId, customerName, customerOrganization, customerAddress, customerGst,
          customerContact, verticalId, budgetAmount, budgetUnit, budgetKnown, emdAmount, emdUnit, salesPersonId,
          buSalesPersonId: buSalesPersonId || null, preSalesId: preSalesId || null, currency,
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
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-white px-4 py-3">
        <div>
          <h1 className="font-display text-lg font-semibold text-ink-900">Create BOQ</h1>
          <p className="text-[12px] text-muted">Configure the commercial proposal, then save as draft or submit for review.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onCancel} disabled={pending !== null}>Cancel</Button>
          <Button onClick={() => save(false)} disabled={pending !== null || !canSave}>
            {pending === 'draft' ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button variant="primary" onClick={() => save(true)} disabled={pending !== null || !canSave}>
            {pending === 'submit' ? 'Submitting…' : 'Save & Submit'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 p-4">
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

        <SectionCard title="Opportunity Information" icon="Briefcase">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Field label="Opportunity Name" hint="Must be unique across all BOQs.">
              <Input value={opportunityName} onChange={(e) => setOpportunityName(e.target.value)} />
            </Field>
            <Field label="Department">
              <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Select…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Vertical" hint="Drives the SKU picker below.">
              <Select value={verticalId} onChange={(e) => handleVerticalChange(e.target.value)}>
                <option value="">Select…</option>
                {verticals.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name}</option>)}
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
              <Select value={salesPersonId} onChange={(e) => setSalesPersonId(e.target.value)}>
                <option value="">Select…</option>
                {salesPersons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
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
            <Field label="Customer"><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></Field>
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
                <Select value={pickerProductId} onChange={(e) => handleProductChange(e.target.value)} className="min-w-[180px]">
                  <option value="">Select…</option>
                  {pickerProducts.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </Select>
              </Field>
              <Field label="Module">
                <Select value={pickerModuleId} onChange={(e) => handleModuleChange(e.target.value)} className="min-w-[180px]" disabled={!pickerProductId}>
                  <option value="">Select…</option>
                  {pickerModules.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                </Select>
              </Field>
              <Field label="Feature">
                <Select value={pickerFeatureId} onChange={(e) => setPickerFeatureId(e.target.value)} className="min-w-[180px]" disabled={!pickerModuleId}>
                  <option value="">Select…</option>
                  {pickerFeatures.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
                </Select>
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
            <p className="mt-2 text-[12px] text-muted">
              Generated SKU: <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{resolvedSku.skuCode}</span>
              {' '}— {resolvedSku.name} · Tax {taxRateById.get(resolvedSku.taxClassId) ?? 0}%
            </p>
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
            <SummaryStat label="Grand Total" value={grandTotal.toLocaleString()} emphasis />
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
              <div className="flex justify-end text-sm font-semibold text-ink-900">Grand Total: {grandTotal.toLocaleString()}</div>
            </div>
          )}
        </SectionCard>
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

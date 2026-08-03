import { useState } from 'react'
import { useCurrentPostings, useDepartments, useSalesPersons } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useBoqMutations, useMasters, useSkus } from '../api'

interface LineDraft {
  skuId: string
  quantity: number
  discountPct: number
}

/** The module's primary journey (spec §12) — a single full-page, section-by-
 *  section workspace, never a modal/wizard dialog. Opportunity Information →
 *  Customer Information → Commercial Configuration → BOQ Summary, all on one
 *  scrollable page, matching split-pane ERP form conventions (SAP CPQ,
 *  Dynamics, Salesforce CPQ, Odoo). */
export function CreateBoq({ onDone }: { onDone: () => void }) {
  const { data: departments = [] } = useDepartments()
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const { data: preSalesList = [] } = useMasters('preSales')
  const { data: verticals = [] } = useMasters('verticals')
  const { data: currencies = [] } = useMasters('currencies')
  const { data: taxClasses = [] } = useMasters('taxClasses')
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
  const [pickerSkuId, setPickerSkuId] = useState('')
  const [pickerQty, setPickerQty] = useState(1)
  const [pickerDiscount, setPickerDiscount] = useState(0)

  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'draft' | 'submit' | null>(null)

  const buSalesPersons = salesPersons.filter((p) => (postings[p.id]?.designation ?? '').toLowerCase().includes('bu sales'))
  const sellableSkus = skus.filter((s) => s.lifecycleStatus === 'active' && s.isSellable)
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const taxRateById = new Map(taxClasses.map((t) => [t.id, t.ratePct]))

  function addLine() {
    if (!pickerSkuId) return
    setLines((prev) => [...prev, { skuId: pickerSkuId, quantity: pickerQty, discountPct: pickerDiscount }])
    setPickerSkuId('')
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
      onDone()
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
          <p className="text-[12px] text-muted">Fill each section, then save as draft or submit for review.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onDone} disabled={pending !== null}>Cancel</Button>
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
            <Field label="Vertical">
              <Select value={verticalId} onChange={(e) => setVerticalId(e.target.value)}>
                <option value="">Select…</option>
                {verticals.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name}</option>)}
              </Select>
            </Field>
            <Field label="Budget Amount"><Input value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} /></Field>
            <Field label="Budget Unit"><Input value={budgetUnit} onChange={(e) => setBudgetUnit(e.target.value)} /></Field>
            <Field label="Budget Known?">
              <Select value={budgetKnown} onChange={(e) => setBudgetKnown(e.target.value)}>
                <option value="">Not answered</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="EMD Amount"><Input value={emdAmount} onChange={(e) => setEmdAmount(e.target.value)} /></Field>
            <Field label="EMD Unit"><Input value={emdUnit} onChange={(e) => setEmdUnit(e.target.value)} /></Field>
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
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-panel/40 p-3">
            <Field label="Product / SKU">
              <Select value={pickerSkuId} onChange={(e) => setPickerSkuId(e.target.value)} className="min-w-[260px]">
                <option value="">Select an active, sellable SKU…</option>
                {sellableSkus.map((s) => <option key={s.id} value={s.id}>{s.skuCode} — {s.name}</option>)}
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
            <Button variant="primary" size="sm" onClick={addLine} disabled={!pickerSkuId}>
              <Icon name="Plus" size={14} />
              Add Line
            </Button>
          </div>

          {lines.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">No SKUs added yet — pick one above to start building the BOQ.</p>
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

        <SectionCard title="BOQ Summary" icon="FileSpreadsheet">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryStat label="Taxes" value={totalTax.toLocaleString()} />
            <SummaryStat label="Margin" value={`${marginPreview.toFixed(1)}%`} />
            <SummaryStat label="Line Items" value={String(lines.length)} />
            <SummaryStat label="Grand Total" value={grandTotal.toLocaleString()} emphasis />
          </div>
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

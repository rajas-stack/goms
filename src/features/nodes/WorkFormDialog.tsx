import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { AddableSelect } from '@/components/ui/AddableSelect'
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useFormDraft } from '@/lib/useFormDraft'
import {
  WORK_COMPONENT_GROUPS, WORK_CURRENCIES, WORK_VALUE_UNITS, WORK_VERTICALS,
  convertWorkAmount, estimateBudgetRangeDisplay, workUnitLabel,
} from './department-meta'
import { DEFAULT_STAGE_KEY, PIPELINE_STAGES } from '@/data/pipeline-stages'
import { SalesTeamPicker } from '@/features/employees/SalesTeamPicker'
import { OpportunityTeamAssignments } from '@/features/teams/OpportunityTeamAssignments'
import type { Opportunity } from '@/lib/types'

type OpportunityDraft = Omit<Opportunity, 'id' | 'departmentId' | 'stateCode' | 'createdAt' | 'createdBy'>

const EMPTY: OpportunityDraft = {
  opportunityName: '', gemTenderId: '', publishDate: '', submissionDate: '',
  vertical: WORK_VERTICALS[0], component: [], quantity: '',
  currency: WORK_CURRENCIES[0].code, valueAmount: '', valueUnit: 'lakh',
  budgetKnown: '', emdAmount: '', emdUnit: 'lakh',
  salesPersonEmail: '',
  geoSalesPersonId: null, buSalesPersonId: null, preSalesPersonId: null, legalPersonId: null, bidTeamMemberId: null,
  stageKey: DEFAULT_STAGE_KEY, closedOn: null,
}

/** Create/edit form for a single sales opportunity ("work"). Opened via the
 *  "Create Opportunity" button on a department's Works panel — never
 *  rendered as part of the add/edit department form. */
export function WorkFormDialog({ open, work, draftKey, managedInBidTracker = false, onClose, onSave }: {
  open: boolean
  /** The opportunity has a bid: Stage and Submission date are owned by Bid Tracker
   *  (the API rejects direct writes to them), so they are shown read-only here. */
  managedInBidTracker?: boolean
  /** Existing opportunity to edit, or null when creating. */
  work: Opportunity | null
  draftKey?: string | null
  onClose: () => void
  onSave: (draft: OpportunityDraft) => void
}) {
  const [form, setForm] = useState<OpportunityDraft>(EMPTY)
  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // `{ ...EMPTY, ...work }` (not just `{ ...work }`) backfills any field
  // missing from a work saved before it existed — e.g. `salesPersonEmail` on
  // an older record — so the form never renders an uncontrolled input.
  const seeded = () => (work ? { ...EMPTY, ...work } : EMPTY)
  const draft = useFormDraft(draftKey ?? null, form, open, () => setForm(seeded()))

  useEffect(() => {
    if (!open) return
    const base = seeded()
    setForm(draft.take(base) ?? base)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, work])

  function submit() {
    if (!form.opportunityName.trim()) return
    onSave({ ...form, opportunityName: form.opportunityName.trim() })
    draft.clear()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={work ? 'Edit opportunity' : 'Create opportunity'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!form.opportunityName.trim()}>
            {work ? 'Save changes' : 'Create opportunity'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {draft.restored && <DraftNotice onDiscard={draft.discard} />}
        <Field label="Opportunity name" required>
          <Input
            value={form.opportunityName}
            onChange={(e) => set('opportunityName', e.target.value)}
            placeholder="e.g. ATCS rollout"
            autoFocus
          />
        </Field>
        {managedInBidTracker && (
          <p role="note" className="rounded-lg bg-panel px-3 py-2 text-[13px] text-ink-700">
            Managed in Bid Tracker — open the bid to change its stage or submission deadline.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="GEM ID / Tender ID">
            <Input value={form.gemTenderId} onChange={(e) => set('gemTenderId', e.target.value)} placeholder="e.g. GEM/2026/B/1234567" />
          </Field>
          <Field label="Vertical">
            <AddableSelect value={form.vertical} onChange={(v) => set('vertical', v)} options={WORK_VERTICALS} storageKey="work-vertical" />
          </Field>
          <Field label="Stage">
            <Select value={form.stageKey} disabled={managedInBidTracker} onChange={(e) => set('stageKey', e.target.value)}>
              {PIPELINE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Publish date">
            <Input type="date" value={form.publishDate} onChange={(e) => set('publishDate', e.target.value)} />
          </Field>
          <Field label="Submission date">
            <Input type="date" value={form.submissionDate} disabled={managedInBidTracker} onChange={(e) => set('submissionDate', e.target.value)} />
          </Field>
          <Field label="Component">
            <MultiSelectDropdown value={form.component} onChange={(v) => set('component', v)} groups={WORK_COMPONENT_GROUPS} storageKey="work-component" searchable searchPlaceholder="Search components…" />
          </Field>
          <Field label="Quantity">
            <Input value={form.quantity} onChange={(e) => set('quantity', e.target.value)} inputMode="numeric" placeholder="0" />
          </Field>
          <Field label="Sales person">
            <SalesTeamPicker value={form.salesPersonEmail} onChange={(email) => set('salesPersonEmail', email)} ariaLabel="Sales person" />
          </Field>
          <OpportunityTeamAssignments
            value={form}
            onChange={(key, id) => set(key, id)}
          />
          <div className="sm:col-span-2">
            <Field label="Budget confirmed?">
              <div className="flex items-center gap-4" role="radiogroup" aria-label="Budget confirmed">
                {(['yes', 'no'] as const).map((v) => (
                  <label key={v} className="flex min-h-[44px] cursor-pointer items-center gap-1.5 pr-2 sm:min-h-0 sm:pr-0">
                    <input
                      type="radio"
                      name="budgetKnown"
                      checked={form.budgetKnown === v}
                      onChange={() => set('budgetKnown', v)}
                      className="accent-ink-900"
                    />
                    <span className="text-sm text-ink-800">{v === 'yes' ? 'Yes' : 'No'}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Value" hint={form.budgetKnown === 'no' ? "Disabled while the budget isn't confirmed — use the EMD fields below instead." : undefined}>
              <div className="flex gap-2">
                <Select
                  value={form.currency}
                  onChange={(e) => set('currency', e.target.value)}
                  disabled={form.budgetKnown === 'no'}
                  className="w-32 shrink-0 disabled:cursor-not-allowed disabled:bg-panel disabled:text-muted"
                >
                  {WORK_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </Select>
                <Input
                  value={form.valueAmount}
                  onChange={(e) => set('valueAmount', e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={form.budgetKnown === 'no'}
                  className="flex-1 disabled:cursor-not-allowed disabled:bg-panel disabled:text-muted"
                />
                <Select
                  value={form.valueUnit}
                  onChange={(e) => {
                    const nextUnit = e.target.value
                    setForm((f) => ({ ...f, valueUnit: nextUnit, valueAmount: convertWorkAmount(f.valueAmount, f.valueUnit, nextUnit) }))
                  }}
                  disabled={form.budgetKnown === 'no'}
                  className="w-28 shrink-0 disabled:cursor-not-allowed disabled:bg-panel disabled:text-muted"
                >
                  {WORK_VALUE_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                </Select>
              </div>
            </Field>
          </div>
          {form.budgetKnown === 'no' && (
            <div className="sm:col-span-2 grid grid-cols-1 gap-4 rounded-card border border-line bg-panel/40 p-4 sm:grid-cols-2">
              <Field label="EMD amount" hint="Used to derive an estimated budget range below">
                <div className="flex gap-2">
                  <Input
                    value={form.emdAmount}
                    onChange={(e) => set('emdAmount', e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="flex-1"
                  />
                  <Select
                    value={form.emdUnit}
                    onChange={(e) => {
                      const nextUnit = e.target.value
                      setForm((f) => ({ ...f, emdUnit: nextUnit, emdAmount: convertWorkAmount(f.emdAmount, f.emdUnit, nextUnit) }))
                    }}
                    className="w-28 shrink-0"
                  >
                    {WORK_VALUE_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </Select>
                </div>
              </Field>
              {(() => {
                const display = estimateBudgetRangeDisplay(form.emdAmount, form.emdUnit)
                return display !== null && (
                  <Field label="Budget (derived)">
                    <p className="flex h-10 items-center rounded-lg border border-line bg-panel px-3 text-sm text-ink-700">
                      ≈ {Number(display.low.toFixed(2))}–{Number(display.high.toFixed(2))} {workUnitLabel(display.unit)}
                    </p>
                  </Field>
                )
              })()}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

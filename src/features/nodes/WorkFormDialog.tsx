import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { AddableSelect } from '@/components/ui/AddableSelect'
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useFormDraft } from '@/lib/useFormDraft'
import { uid } from '@/lib/utils'
import {
  WORK_COMPONENT_GROUPS, WORK_CURRENCIES, WORK_VALUE_UNITS, WORK_VERTICALS, estimateBudgetFromEmd, workUnitLabel,
} from './department-meta'
import { SalesTeamPicker } from '@/features/employees/SalesTeamPicker'
import type { DepartmentWork } from '@/lib/types'

const EMPTY: Omit<DepartmentWork, 'id'> = {
  opportunityName: '', gemTenderId: '', publishDate: '', submissionDate: '',
  vertical: WORK_VERTICALS[0], component: [], quantity: '',
  currency: WORK_CURRENCIES[0].code, valueAmount: '', valueUnit: 'lakh',
  budgetKnown: '', emdAmount: '', emdUnit: 'lakh', emdPercent: '',
  salesPersonEmail: '',
}

/** Create/edit form for a single sales opportunity ("work"). Opened via the
 *  "Create Opportunity" button on a department's Works panel — never
 *  rendered as part of the add/edit department form. */
export function WorkFormDialog({ open, work, draftKey, onClose, onSave }: {
  open: boolean
  /** Existing work to edit, or null when creating a new one. */
  work: DepartmentWork | null
  /** Identifies this exact form for draft persistence — see `WorksEditor`.
   *  `null`/omitted disables drafting. */
  draftKey?: string | null
  onClose: () => void
  onSave: (work: DepartmentWork) => void
}) {
  const [form, setForm] = useState<Omit<DepartmentWork, 'id'>>(EMPTY)
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
    onSave({ id: work?.id ?? uid('work'), ...form, opportunityName: form.opportunityName.trim() })
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
        <Field label="Opportunity name">
          <Input
            value={form.opportunityName}
            onChange={(e) => set('opportunityName', e.target.value)}
            placeholder="e.g. ATCS rollout"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="GEM ID / Tender ID">
            <Input value={form.gemTenderId} onChange={(e) => set('gemTenderId', e.target.value)} placeholder="e.g. GEM/2026/B/1234567" />
          </Field>
          <Field label="Vertical">
            <AddableSelect value={form.vertical} onChange={(v) => set('vertical', v)} options={WORK_VERTICALS} storageKey="work-vertical" />
          </Field>
          <Field label="Publish date">
            <Input type="date" value={form.publishDate} onChange={(e) => set('publishDate', e.target.value)} />
          </Field>
          <Field label="Submission date">
            <Input type="date" value={form.submissionDate} onChange={(e) => set('submissionDate', e.target.value)} />
          </Field>
          <Field label="Component">
            <MultiSelectDropdown value={form.component} onChange={(v) => set('component', v)} groups={WORK_COMPONENT_GROUPS} storageKey="work-component" />
          </Field>
          <Field label="Quantity">
            <Input value={form.quantity} onChange={(e) => set('quantity', e.target.value)} inputMode="numeric" placeholder="0" />
          </Field>
          <Field label="Sales person">
            <SalesTeamPicker value={form.salesPersonEmail} onChange={(email) => set('salesPersonEmail', email)} />
          </Field>
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
            <Field label="Value">
              <div className="flex gap-2">
                <Select value={form.currency} onChange={(e) => set('currency', e.target.value)} className="w-32 shrink-0">
                  {WORK_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </Select>
                <Input
                  value={form.valueAmount}
                  onChange={(e) => set('valueAmount', e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="flex-1"
                />
                <Select value={form.valueUnit} onChange={(e) => set('valueUnit', e.target.value)} className="w-28 shrink-0">
                  {WORK_VALUE_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                </Select>
              </div>
            </Field>
          </div>
          {form.budgetKnown === 'no' && (
            <div className="sm:col-span-2 grid grid-cols-1 gap-4 rounded-card border border-line bg-panel/40 p-4 sm:grid-cols-2">
              <Field label="EMD amount" hint="Informational only — doesn't change the value above">
                <div className="flex gap-2">
                  <Input
                    value={form.emdAmount}
                    onChange={(e) => set('emdAmount', e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="flex-1"
                  />
                  <Select value={form.emdUnit} onChange={(e) => set('emdUnit', e.target.value)} className="w-28 shrink-0">
                    {WORK_VALUE_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </Select>
                </div>
              </Field>
              <Field label="EMD %">
                <Input
                  value={form.emdPercent}
                  onChange={(e) => set('emdPercent', e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 2"
                />
              </Field>
              {(() => {
                const estimate = estimateBudgetFromEmd(form.emdAmount, form.emdPercent)
                return estimate !== null && (
                  <p className="text-xs text-muted sm:col-span-2">
                    Estimated budget: ≈ {Number(estimate.toFixed(2))} {workUnitLabel(form.emdUnit)}
                  </p>
                )
              })()}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

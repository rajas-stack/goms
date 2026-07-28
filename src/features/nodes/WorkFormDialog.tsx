import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { AddableSelect } from '@/components/ui/AddableSelect'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useFormDraft } from '@/lib/useFormDraft'
import { uid } from '@/lib/utils'
import { WORK_COMPONENTS, WORK_VERTICALS } from './department-meta'
import type { DepartmentWork } from '@/lib/types'

const EMPTY: Omit<DepartmentWork, 'id'> = {
  opportunityName: '', gemTenderId: '', publishDate: '', submissionDate: '',
  vertical: WORK_VERTICALS[0], component: WORK_COMPONENTS[0], quantity: '', value: '',
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

  const draft = useFormDraft(draftKey ?? null, form, open, () => setForm(work ? { ...work } : EMPTY))

  useEffect(() => {
    if (!open) return
    const base = work ? { ...work } : EMPTY
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
            <AddableSelect value={form.component} onChange={(v) => set('component', v)} options={WORK_COMPONENTS} storageKey="work-component" />
          </Field>
          <Field label="Quantity">
            <Input value={form.quantity} onChange={(e) => set('quantity', e.target.value)} inputMode="numeric" placeholder="0" />
          </Field>
          <Field label="Value">
            <Input value={form.value} onChange={(e) => set('value', e.target.value)} placeholder="₹ / amount" />
          </Field>
        </div>
      </div>
    </Dialog>
  )
}

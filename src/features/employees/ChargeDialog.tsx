import { NO_PERMISSION_TITLE, useAllowed, usePermissions } from '@/lib/permissions'
import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useToast } from '@/components/ui/Toast'
import { useEmployeeMutations } from '@/lib/api'
import { isoToday } from '@/data/repository'
import { useFormDraft } from '@/lib/useFormDraft'
import type { Charge } from '@/lib/types'

const emptyForm = () => ({
  kind: 'additional' as Charge['kind'], title: '', startDate: isoToday(), endDate: '', reason: '',
})

export function ChargeDialog({ open, employeeId, onClose }: {
  open: boolean
  employeeId: string | null
  onClose: () => void
}) {
  const toast = useToast()
  const { addCharge } = useEmployeeMutations()
  const allowed = useAllowed('am.contacts', 'update')
  const [form, setForm] = useState(emptyForm)

  const draftKey = employeeId ? `charge:${employeeId}` : null
  const draft = useFormDraft(draftKey, form, open, () => setForm(emptyForm()))

  useEffect(() => {
    if (open) setForm(draft.take(emptyForm()) ?? emptyForm())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employeeId])

  const isActing = form.kind === 'acting'

  async function submit() {
    if (!employeeId || !form.title.trim()) return
    await addCharge.mutateAsync({
      employeeId,
      charge: {
        kind: form.kind, title: form.title.trim(), orgNodeId: null,
        startDate: form.startDate || null,
        endDate: isActing ? (form.endDate || null) : null,
        reason: form.reason.trim(),
      },
    })
    toast(`${isActing ? 'Acting' : 'Additional'} charge added`)
    draft.clear()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add charge"
      description="Acting (temporary) or Additional (concurrently held) posting."
      footer={
        <>
          <Button onClick={onClose} disabled={addCharge.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={(!form.title.trim() || addCharge.isPending) || !allowed} title={allowed ? undefined : NO_PERMISSION_TITLE}>
            {addCharge.isPending ? 'Adding…' : 'Add charge'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {draft.restored && <DraftNotice onDiscard={draft.discard} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Charge type">
            <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as Charge['kind'] }))}>
              <option value="additional">Additional charge</option>
              <option value="acting">Acting charge</option>
            </Select>
          </Field>
          <Field label="Position title" required>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. CEO Smart City"
              autoFocus
            />
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          {isActing && (
            <Field label="End date">
              <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </Field>
          )}
        </div>
        <Field label="Reason">
          <Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  )
}

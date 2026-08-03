import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useMasters } from '../api'
import type { MasterDef, MasterFieldDef } from '../master-defs'
import type { MasterBase, MasterEntityKey } from '../types'

type FormValues = Record<string, string | number | boolean>
type MasterRow = MasterBase & Record<string, unknown>

function defaultValues(def: MasterDef, existing: MasterRow | null): FormValues {
  const base: FormValues = {
    code: existing?.code ?? '',
    name: existing?.name ?? '',
    description: existing?.description ?? '',
  }
  for (const f of def.fields) {
    const v = existing?.[f.key]
    if (f.type === 'boolean') base[f.key] = Boolean(v)
    else if (f.type === 'number') base[f.key] = typeof v === 'number' ? v : 0
    else base[f.key] = typeof v === 'string' ? v : ''
  }
  return base
}

function FieldInput({ field, value, onChange, options }: {
  field: MasterFieldDef
  value: string | number | boolean
  onChange: (v: string | number | boolean) => void
  options: { value: string; label: string }[]
}) {
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-ink-800">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    )
  }
  if (field.type === 'select') {
    return (
      <Field label={field.label}>
        <Select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
    )
  }
  if (field.type === 'textarea') {
    return (
      <Field label={field.label}>
        <Textarea value={String(value)} onChange={(e) => onChange(e.target.value)} />
      </Field>
    )
  }
  return (
    <Field label={field.label}>
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        value={String(value)}
        onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </Field>
  )
}

/** Generic create/edit form for any of the 12 master tables, driven entirely
 *  by `MASTER_DEFS[masterKey]` — spec §4.4. `code`/`name`/`description` are
 *  always present (every master extends `MasterBase`); `def.fields` supplies
 *  whatever else that particular master needs. Assumes at most one
 *  `parentMasterKey` field per master (true for all 12 today). */
export function MasterFormDialog({ masterKey, def, open, onClose, editing, onSubmit }: {
  masterKey: MasterEntityKey
  def: MasterDef
  open: boolean
  onClose: () => void
  /** null = create */
  editing: MasterRow | null
  onSubmit: (values: FormValues, changeReason?: string) => Promise<void>
}) {
  const [values, setValues] = useState<FormValues>(() => defaultValues(def, editing))
  const [changeReason, setChangeReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(defaultValues(def, editing))
      setChangeReason('')
      setError(null)
    }
  }, [open, def, editing])

  const parentField = def.fields.find((f) => f.parentMasterKey)
  const { data: parentRows = [] } = useMasters(parentField?.parentMasterKey ?? 'verticals')

  const set = (key: string, v: string | number | boolean) => setValues((prev) => ({ ...prev, [key]: v }))

  // `editing` is truthy but has `id: ''` when HierarchyView's "Add Feature"
  // child button pre-fills a parent id via a stub row (see HierarchyView.tsx) —
  // that's still a CREATE, not an edit, so title/reason logic keys off a real
  // id rather than mere truthiness.
  const isEditingRow = !!editing?.id

  // Feature status changes require an audit reason (spec §15/§6.6) — the
  // only master with this requirement, so the field only appears here.
  const statusChanging = masterKey === 'features' && isEditingRow && values.status !== editing.status

  async function submit() {
    setPending(true)
    setError(null)
    try {
      await onSubmit(values, statusChanging ? changeReason : undefined)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setPending(false)
    }
  }

  const canSubmit = String(values.code ?? '').trim().length > 0 && String(values.name ?? '').trim().length > 0
    && (!statusChanging || changeReason.trim().length > 0)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEditingRow ? `Edit ${def.singularLabel}` : `Add ${def.singularLabel}`}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={pending || !canSubmit}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Code"><Input value={String(values.code ?? '')} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="Name"><Input value={String(values.name ?? '')} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Description">
          <Textarea value={String(values.description ?? '')} onChange={(e) => set('description', e.target.value)} />
        </Field>
        {def.fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={values[f.key]}
            onChange={(v) => set(f.key, v)}
            options={f.options ?? (f.parentMasterKey ? parentRows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` })) : [])}
          />
        ))}
        {statusChanging && (
          <Field label="Reason for status change" hint="Required — recorded in the Audit Log.">
            <Input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
          </Field>
        )}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      </div>
    </Dialog>
  )
}

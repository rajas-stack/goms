import { useEffect, useState } from 'react'
import { hasOptions, type CustomFieldType } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { useBidCustomFieldMutations } from '@/lib/api'
import type { BidCustomField } from '@/lib/types'
import { useEntityLookups } from '../useEntityLookups'
import { OptionsEditor } from './OptionsEditor'

/** Grouped for the picker: basics first, then structured types, then the types
 *  that point at an existing GOMS record (stored as a reference, never a copy). */
const TYPE_GROUPS: { label: string; types: { type: CustomFieldType; label: string; hint?: string }[] }[] = [
  { label: 'Basic', types: [
    { type: 'text', label: 'Text' }, { type: 'number', label: 'Number' }, { type: 'date', label: 'Date' },
    { type: 'boolean', label: 'Yes / No' }, { type: 'select', label: 'Select (dropdown)' }, { type: 'multiselect', label: 'Multi-select', hint: 'Pick several options from a fixed list.' },
  ] },
  { label: 'Structured', types: [
    { type: 'currency', label: 'Amount (₹)', hint: 'A rupee amount, shown as ₹5,00,000.' },
    { type: 'url', label: 'URL', hint: 'A web address that opens in a new tab.' },
    { type: 'email', label: 'Email' }, { type: 'phone', label: 'Phone' },
  ] },
  { label: 'Linked to GOMS records', types: [
    { type: 'person', label: 'Sales person', hint: 'Choose from the Sales Team — stored as a link, so a rename carries through.' },
    { type: 'department', label: 'Department', hint: 'Choose from Account Mapping departments.' },
    { type: 'state', label: 'State', hint: 'Choose a state or UT.' },
  ] },
]
const TYPE_HINT = new Map(TYPE_GROUPS.flatMap((g) => g.types.map((t) => [t.type, t.hint] as const)))

/** Creates a user-defined column. The data type is fixed once created (changing
 *  it under existing values would corrupt them) — the dialog says so. */
export function AddCustomColumnDialog({ open, onClose, onCreated, sheet }: {
  /** The sheet that will own the new column (default: Bid Tracker). */
  sheet?: BidCustomField['sheet']
  open: boolean
  onClose: () => void
  onCreated?: (field: BidCustomField) => void
}) {
  const [name, setName] = useState('')
  const [dataType, setDataType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [error, setError] = useState<string | null>(null)
  const { create } = useBidCustomFieldMutations()
  const lookups = useEntityLookups()
  // What the cell pick-list will offer, straight from the saved Account Mapping / Sales Team records.
  const available = dataType === 'person' ? { n: lookups.persons.length, noun: 'sales people', where: 'the Sales Team' }
    : dataType === 'department' ? { n: lookups.departments.length, noun: 'departments', where: 'Account Mapping' }
    : dataType === 'state' ? { n: lookups.states.length, noun: 'states', where: 'Account Mapping' } : null

  useEffect(() => {
    if (open) { setName(''); setDataType('text'); setOptions(['', '']); setError(null) }
  }, [open])

  const submit = async () => {
    setError(null)
    try {
      const field = await create.mutateAsync({
        name: name.trim(), dataType, sheet, ...(hasOptions(dataType) ? { options } : {}),
      })
      onCreated?.(field)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the column.')
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title="Add column"
      description="A custom column gets a value per bid, editable right in the grid."
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={submit}>Add column</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="Column name" required>
          <Input value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Client Contact, Win Probability" />
        </Field>
        <Field label="Data type" hint={`${TYPE_HINT.get(dataType) ?? ''} The type cannot be changed later.`.trim()}>
          <Select value={dataType} onChange={(e) => setDataType(e.target.value as CustomFieldType)}>
            {TYPE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        {available && (
          <p className="-mt-2 text-[12.5px] text-muted" data-testid="linked-count">
            {available.n > 0
              ? `${available.n} ${available.noun} already saved in ${available.where} will be offered in this column.`
              : `No ${available.noun} are saved in ${available.where} yet — add them there and they will appear here.`}
          </p>
        )}
        {hasOptions(dataType) && (
          <Field label="Options" required hint="Blank and duplicate options are dropped.">
            <OptionsEditor value={options} onChange={setOptions} />
          </Field>
        )}
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
      </div>
    </Dialog>
  )
}

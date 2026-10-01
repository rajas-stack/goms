import { useEffect, useState } from 'react'
import { CUSTOM_FIELD_TYPES, type CustomFieldType } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { useBidCustomFieldMutations } from '@/lib/api'
import type { BidCustomField } from '@/lib/types'
import { OptionsEditor } from './OptionsEditor'

const TYPE_LABEL: Record<CustomFieldType, string> = {
  text: 'Text', number: 'Number', date: 'Date', select: 'Select (dropdown)', boolean: 'Yes / No',
}

/** Creates a user-defined column. The data type is fixed once created (changing
 *  it under existing values would corrupt them) — the dialog says so. */
export function AddCustomColumnDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated?: (field: BidCustomField) => void
}) {
  const [name, setName] = useState('')
  const [dataType, setDataType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [error, setError] = useState<string | null>(null)
  const { create } = useBidCustomFieldMutations()

  useEffect(() => {
    if (open) { setName(''); setDataType('text'); setOptions(['', '']); setError(null) }
  }, [open])

  const submit = async () => {
    setError(null)
    try {
      const field = await create.mutateAsync({
        name: name.trim(), dataType, ...(dataType === 'select' ? { options } : {}),
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
        <Field label="Data type" hint="The type cannot be changed later.">
          <Select value={dataType} onChange={(e) => setDataType(e.target.value as CustomFieldType)}>
            {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        {dataType === 'select' && (
          <Field label="Options" required hint="Blank and duplicate options are dropped.">
            <OptionsEditor value={options} onChange={setOptions} />
          </Field>
        )}
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
      </div>
    </Dialog>
  )
}

import { useState } from 'react'
import { CUSTOM_FIELD_TYPES, customTypesCompatible, hasOptions, type CustomFieldType } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Select } from '@/components/ui/Field'
import { useBidCustomFieldMutations } from '@/lib/api'
import type { BidCustomField } from '@/lib/types'
import { CUSTOM_TYPE_LABEL } from '../gridColumns'
import { OptionsEditor } from './OptionsEditor'

export function ChangeColumnTypeDialog({ field, onClose, onChanged }: {
  field: BidCustomField
  onClose: () => void
  onChanged: () => void
}) {
  const [dataType, setDataType] = useState<CustomFieldType>(field.dataType)
  const [options, setOptions] = useState(field.options ?? ['', ''])
  const [error, setError] = useState<string | null>(null)
  const { update } = useBidCustomFieldMutations()
  const changedType = dataType !== field.dataType
  const compatible = customTypesCompatible(field.dataType, dataType)
  const changedOptions = hasOptions(dataType) && JSON.stringify(options) !== JSON.stringify(field.options ?? [])
  const save = async () => {
    setError(null)
    try {
      await update.mutateAsync({ id: field.id, patch: {
        dataType, expectedDataType: field.dataType, resetValues: !compatible,
        ...(hasOptions(dataType) ? { options } : {}),
      } })
      if (changedType) onChanged()
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change the column type.') }
  }
  return <Dialog open onClose={() => { if (!update.isPending) onClose() }} title="Change data type"
    description={`Changes apply to “${field.name}” and its values across all opportunities and views.`}
    footer={<div className="flex justify-end gap-2">
      <Button variant="secondary" disabled={update.isPending} onClick={onClose}>Cancel</Button>
      <Button variant={!compatible && field.hasHeldValue ? 'danger' : 'primary'} disabled={update.isPending || !changedType && !changedOptions}
        onClick={() => void save()}>{update.isPending ? 'Saving…' : !compatible && field.hasHeldValue ? 'Change type and reset values' : 'Save changes'}</Button>
    </div>}>
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Current type: {CUSTOM_TYPE_LABEL[field.dataType]}</p>
      <Field label="New data type"><Select value={dataType} disabled={update.isPending} onChange={event => { setDataType(event.target.value as CustomFieldType); setError(null) }}>
        {CUSTOM_FIELD_TYPES.map(type => <option key={type} value={type}>{CUSTOM_TYPE_LABEL[type]}</option>)}
      </Select></Field>
      {changedType && <p role="status" className={compatible ? 'text-sm text-muted' : 'text-sm text-crimson'}>
        {compatible
          ? 'Compatible change: existing values are retained. Values must be valid for the new type; a single dropdown can hold only one choice per cell.'
          : 'Different type: existing values in this column will be cleared for every opportunity. Other columns are unaffected.'}
      </p>}
      {hasOptions(dataType) && <fieldset disabled={update.isPending}>
        <legend className="mb-2 text-sm font-medium">Dropdown options</legend>
        <OptionsEditor value={options} onChange={setOptions} />
        <p className="mt-2 text-xs text-muted">Add, remove or reorder choices. Removing a choice keeps existing values, but stops offering it for new selections.</p>
      </fieldset>}
      {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
    </div>
  </Dialog>
}

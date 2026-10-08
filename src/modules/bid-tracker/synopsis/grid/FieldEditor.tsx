import { useState } from 'react'
import { GRID_FIELD_TYPES, GRID_LIMITS, GRID_OPTION_COLORS, type GridColumn, type GridFieldType, type GridOptionColor, type GridSelectOption } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { FIELD_TYPE_LABELS, makeOption } from './gridModel'

const SWATCH: Record<GridOptionColor, string> = {
  blue: 'bg-blue-100', emerald: 'bg-emerald-100', amber: 'bg-amber-100', crimson: 'bg-crimson-100', purple: 'bg-purple-100', gray: 'bg-panel',
}

export interface FieldDraft { name: string; type: GridFieldType; options?: GridSelectOption[] }

/** Create or edit a column ("field" in Baserow terms): name, type and, for
 *  dropdown types, the list of choices. */
export function FieldEditor({ column, title, onSave, onClose }: {
  column: FieldDraft
  title: string
  onSave: (draft: FieldDraft) => void
  onClose: () => void
}) {
  const [name, setName] = useState(column.name)
  const [type, setType] = useState<GridFieldType>(column.type)
  const [options, setOptions] = useState<GridSelectOption[]>(column.options ?? [])
  const [error, setError] = useState<string | null>(null)
  const isSelect = type === 'singleSelect' || type === 'multiSelect'
  const typeChanged = column.type !== type && !!column.name

  const save = () => {
    if (!name.trim()) { setError('Give the column a name.'); return }
    const values = options.map(o => o.value.trim().toLowerCase())
    if (isSelect && values.some(v => !v)) { setError('Dropdown options cannot be empty.'); return }
    if (isSelect && new Set(values).size !== values.length) { setError('Dropdown options must be unique.'); return }
    onSave({ name: name.trim(), type, ...(isSelect ? { options: options.map(o => ({ ...o, value: o.value.trim() })) } : {}) })
  }

  return (
    <Dialog open onClose={onClose} title={title} footer={<>
      <Button size="sm" onClick={onClose}>Cancel</Button>
      <Button size="sm" variant="primary" onClick={save}>Save</Button>
    </>}>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); save() }}>
        <Field label="Column name" required>
          <Input autoFocus value={name} maxLength={GRID_LIMITS.name} onChange={event => setName(event.target.value)} />
        </Field>
        <Field label="Column type" hint={typeChanged ? 'Existing values are converted. Values that do not fit the new type are cleared.' : undefined}>
          <Select value={type} onChange={event => setType(event.target.value as GridFieldType)}>
            {GRID_FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        {isSelect && (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-[13px] font-medium text-ink-800">Dropdown options</legend>
            {!options.length && column.type !== type && <p className="text-[12px] text-muted">Leave empty to build options from the existing values.</p>}
            {options.map((option, index) => (
              <div key={option.id} className="flex items-center gap-2">
                <div className="flex gap-0.5" role="radiogroup" aria-label={`Colour for option ${index + 1}`}>
                  {GRID_OPTION_COLORS.map(color => (
                    <button key={color} type="button" role="radio" aria-checked={option.color === color} aria-label={color}
                      onClick={() => setOptions(list => list.map(o => (o.id === option.id ? { ...o, color } : o)))}
                      className={cn('h-5 w-5 rounded border', SWATCH[color], option.color === color ? 'border-goms-navy ring-1 ring-goms-navy' : 'border-line')} />
                  ))}
                </div>
                <Input aria-label={`Option ${index + 1}`} className="h-8" value={option.value} maxLength={GRID_LIMITS.name}
                  onChange={event => setOptions(list => list.map(o => (o.id === option.id ? { ...o, value: event.target.value } : o)))} />
                <button type="button" aria-label={`Remove option ${index + 1}`} onClick={() => setOptions(list => list.filter(o => o.id !== option.id))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-crimson-100 hover:text-crimson">
                  <Icon name="Trash2" size={14} />
                </button>
              </div>
            ))}
            <Button size="sm" disabled={options.length >= GRID_LIMITS.options}
              onClick={() => setOptions(list => [...list, makeOption('', list.length)])}>
              <Icon name="Plus" size={13} /> Add option
            </Button>
          </fieldset>
        )}
        {error && <p role="alert" className="text-[12px] text-crimson">{error}</p>}
      </form>
    </Dialog>
  )
}

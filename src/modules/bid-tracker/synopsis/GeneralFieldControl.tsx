import { useState } from 'react'
import { FriendlyDateInput } from '@/components/ui/FriendlyDateInput'
import { Input, Select, Textarea } from '@/components/ui/Field'
import { friendlyValueToDate, type FriendlyDateFormat } from '@/lib/friendlyDate'
import { cn } from '@/lib/utils'
import { DepartmentField } from './DepartmentField'
import type { GeneralField } from './generalFields'
import { WebsitesField } from './WebsitesField'
import { MeetingMapLink } from './MeetingMapLink'

export const COMPLIANCE_TONE: Record<string, string> = {
  complied: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'partially complied': 'border-amber-200 bg-amber-50 text-ink',
  'not complied': 'border-crimson/40 bg-crimson-100 text-crimson',
}

/** The stored format of a date / date-time field (null for other kinds). */
export function dateFormatOf(field: GeneralField): FriendlyDateFormat | null {
  return field.kind === 'date' ? 'date' : field.kind === 'datetime' ? 'datetime-local' : null
}

interface Props {
  field: GeneralField
  value: string
  onChange: (value: string) => void
  /** Reports whether typed date text could not be read as a date. */
  onValidityChange: (invalid: boolean) => void
}

/** Typed control per field. A value that does not fit the typed control (e.g.
 *  "05.11.2026 at 12 Noon" in a date field, or a custom choice) falls back to a
 *  text box so nothing already entered is hidden or lost. */
export function GeneralFieldControl({ field, value, onChange, onValidityChange }: Props) {
  const id = `general-${field.key}`
  const common = { id, 'aria-label': field.label, value, placeholder: field.placeholder }
  const format = dateFormatOf(field)
  // Decided once per mount: a half-typed date can briefly produce an odd value
  // (e.g. year "202"), which must not swap the control out from under the user.
  const [isFriendlyDate] = useState(() => !!format && (!value || !!friendlyValueToDate(value, format)))
  if (field.kind === 'address') return (
    <div className="flex flex-wrap items-start gap-2">
      <Textarea {...common} rows={2} className="min-w-[12rem] flex-1" onChange={event => onChange(event.target.value)} />
      <MeetingMapLink address={value} />
    </div>
  )
  if (field.kind === 'textarea') return <Textarea {...common} rows={3} onChange={event => onChange(event.target.value)} />
  if (format && isFriendlyDate) {
    return (
      <FriendlyDateInput id={id} aria-label={field.label} format={format} value={value}
        onChange={(next, change) => { onValidityChange(change.invalid); onChange(next) }} />
    )
  }
  if (field.kind === 'department') return <DepartmentField id={id} label={field.label} value={value} onChange={onChange} />
  if (field.kind === 'websites') return <WebsitesField id={id} label={field.label} value={value} onChange={onChange} />
  if (field.kind === 'url') return <Input {...common} type="url" inputMode="url" onChange={event => onChange(event.target.value)} />
  if (field.kind === 'select' && (!value || field.options?.includes(value))) {
    return (
      <Select {...common} className={cn('capitalize', COMPLIANCE_TONE[value])} onChange={event => onChange(event.target.value)}>
        <option value="">—</option>
        {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
      </Select>
    )
  }
  return <Input {...common} onChange={event => onChange(event.target.value)} />
}

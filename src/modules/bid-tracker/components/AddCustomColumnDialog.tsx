import { NO_PERMISSION_TITLE, useAllowed } from '@/lib/permissions'
import { useEffect, useMemo, useState } from 'react'
import { hasOptions, type CustomFieldType } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { useVerticalNames } from '@/features/masters/useMasterOptions'
import { useBidCustomFieldMutations } from '@/lib/api'
import type { BidCustomField } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CUSTOM_COLUMN_PREFIX } from '../gridColumns'
import { matchingPeople, toCandidates } from '../peopleColumns'
import { useSetPeopleColumnConfig } from '../peopleColumnsApi'
import { useEntityLookups } from '../useEntityLookups'
import { OptionsEditor } from './OptionsEditor'

/** Grouped for the picker: basics first, then structured types, then the types
 *  that point at an existing GOMS record (stored as a reference, never a copy). */
const TYPE_GROUPS: { label: string; types: { type: CustomFieldType; label: string; hint?: string }[] }[] = [
  { label: 'Basic', types: [
    { type: 'text', label: 'Text' }, { type: 'number', label: 'Number' }, { type: 'date', label: 'Date' },
    { type: 'boolean', label: 'Yes / No' },
    { type: 'select', label: 'Dropdown (single)', hint: 'Pick one option from the list below.' },
    { type: 'multiselect', label: 'Dropdown (multiple)', hint: 'Pick several options from the list below.' },
  ] },
  { label: 'Structured', types: [
    { type: 'currency', label: 'Amount (₹)', hint: 'A rupee amount, shown as ₹5,00,000.' },
    { type: 'url', label: 'URL', hint: 'A web address that opens in a new tab.' },
    { type: 'email', label: 'Email' }, { type: 'phone', label: 'Phone' },
  ] },
  { label: 'Linked to GOMS records', types: [
    { type: 'person', label: 'People', hint: 'Amnex employees, narrowed by vertical and department below — stored as a link, so a rename carries through.' },
    { type: 'department', label: 'Department', hint: 'Choose from Account Mapping departments.' },
    { type: 'state', label: 'State', hint: 'Choose a state or UT.' },
  ] },
]
const TYPE_HINT = new Map(TYPE_GROUPS.flatMap((g) => g.types.map((t) => [t.type, t.hint] as const)))

/** Creates a user-defined column; later type changes use the column's Change data type dialog. */
export function AddCustomColumnDialog({ open, onClose, onCreated, sheet }: {
  /** The sheet that will own the new column (default: Live Bids). */
  sheet?: BidCustomField['sheet']
  open: boolean
  onClose: () => void
  onCreated?: (field: BidCustomField) => void
}) {
  const [name, setName] = useState('')
  const [dataType, setDataType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [error, setError] = useState<string | null>(null)
  // People: which Amnex employees the column offers, and how many per cell.
  const [verticals, setVerticals] = useState<string[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [multiple, setMultiple] = useState(false)
  const { create } = useBidCustomFieldMutations()
  const setPeople = useSetPeopleColumnConfig()
  const allowed = useAllowed('bid.columns', 'create')
  const lookups = useEntityLookups()
  const verticalNames = useVerticalNames()
  const employees = useMemo(
    () => (lookups.people ? toCandidates(lookups.employees ?? [], 'employees', lookups.people) : []),
    [lookups.employees, lookups.people],
  )
  // Departments follow the verticals: only those with employees in the chosen verticals.
  const departmentNames = useMemo(
    () => [...new Set(matchingPeople(employees, verticals, []).flatMap((e) => e.departments))].sort((a, b) => a.localeCompare(b)),
    [employees, verticals],
  )
  const offered = matchingPeople(employees, verticals, departments).length
  const pickVerticals = (next: string[]) => {
    setVerticals(next)
    const still = new Set(matchingPeople(employees, next, []).flatMap((e) => e.departments))
    setDepartments((current) => current.filter((d) => still.has(d)))
  }
  // What the cell pick-list will offer, straight from the saved Account Mapping records.
  const available = dataType === 'department' ? { n: lookups.departments.length, noun: 'departments', where: 'Account Mapping' }
    : dataType === 'state' ? { n: lookups.states.length, noun: 'states', where: 'Account Mapping' } : null

  useEffect(() => {
    if (open) { setName(''); setDataType('text'); setOptions(['', '']); setError(null); setVerticals([]); setDepartments([]); setMultiple(false) }
  }, [open])

  const submit = async () => {
    setError(null)
    try {
      const field = await create.mutateAsync({
        name: name.trim(), dataType, sheet, ...(hasOptions(dataType) ? { options } : {}),
      })
      if (dataType === 'person' && (verticals.length || departments.length || multiple)) {
        await setPeople.mutateAsync({ columnId: CUSTOM_COLUMN_PREFIX + field.key, config: { verticals, departments, people: [], multiple } })
      }
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
          <Button variant="primary" disabled={!name.trim() || create.isPending || !allowed} title={allowed ? undefined : NO_PERMISSION_TITLE} onClick={submit}>Add column</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="Column name" required>
          <Input value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Client Contact, Win Probability" />
        </Field>
        <Field label="Data type" hint={TYPE_HINT.get(dataType)}>
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
        {dataType === 'person' && (
          <>
            <Field label="Verticals" hint="Employees in any of these verticals. None picked = every vertical.">
              <ChipPicker label="Verticals" options={verticalNames} value={verticals} onChange={pickVerticals} />
            </Field>
            <Field label="Departments" hint={verticals.length ? 'Departments with employees in the chosen verticals. None picked = all of them.' : 'None picked = every department.'}>
              {departmentNames.length
                ? <ChipPicker label="Departments" options={departmentNames} value={departments} onChange={setDepartments} />
                : <p className="text-[12.5px] text-muted">No employees in these verticals yet. Set verticals on employees in Org Structure.</p>}
            </Field>
            <Field label="People per cell">
              <div role="group" aria-label="People per cell" className="flex w-fit rounded-lg border border-line p-0.5">
                {(['Single', 'Multiple'] as const).map((mode) => (
                  <button
                    key={mode} type="button" aria-pressed={(mode === 'Multiple') === multiple} onClick={() => setMultiple(mode === 'Multiple')}
                    className={cn('rounded-md px-2.5 py-1 text-[12px]', (mode === 'Multiple') === multiple ? 'bg-goms-navy text-paper' : 'text-ink')}
                  >{mode}</button>
                ))}
              </div>
            </Field>
            <p className="-mt-2 text-[12.5px] text-muted" data-testid="linked-count">
              {offered} Amnex {offered === 1 ? 'employee' : 'employees'} will be offered in this column.
            </p>
          </>
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

/** Toggle chips for a short list (verticals, departments): pressed = chosen. */
function ChipPicker({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = value.includes(option)
        return (
          <button
            key={option} type="button" aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== option) : [...value, option])}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[12.5px] transition-colors focus-visible:focus-ring',
              on ? 'border-goms-navy bg-goms-navy text-paper' : 'border-line text-ink hover:bg-goms-sky/[0.12]',
            )}
          >{option}</button>
        )
      })}
    </div>
  )
}

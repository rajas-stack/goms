import { useMemo } from 'react'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { useEntityLookups } from '../useEntityLookups'

/** Departments from Account Mapping as a searchable dropdown. The stored value
 *  is the department's name, so a value typed before this was a dropdown (or a
 *  department since renamed) still shows and is kept until changed. */
export function DepartmentField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const { departments } = useEntityLookups()
  const options = useMemo<ComboboxOption[]>(() => {
    const fromMapping = departments.map(department => ({ value: department.label, label: department.label }))
    const current = value.trim()
    if (!current || fromMapping.some(option => option.value === current)) return fromMapping
    return [{ value: current, label: current, searchText: 'not in account mapping' }, ...fromMapping]
  }, [departments, value])

  return (
    <div id={id}>
      <Combobox aria-label={label} value={value.trim()} options={options} placeholder="Choose a department from Account Mapping" onChange={onChange} />
      {value.trim() && !departments.some(department => department.label === value.trim()) && (
        <p className="mt-1 text-[11px] text-muted">Kept as entered. It is not a department in Account Mapping.</p>
      )}
    </div>
  )
}

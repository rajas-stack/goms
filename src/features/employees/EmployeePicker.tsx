import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { initials } from '@/lib/utils'
import type { Employee } from '@/lib/types'

interface Props {
  candidates: Employee[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  emptyLabel?: string
}

/** Searchable, select-only person picker (no inline create). Used wherever a
 *  field must reference someone already in the system — department head, sales
 *  ownership, etc. Mirrors ManagerPicker's look without the create affordance. */
export function EmployeePicker({
  candidates, value, onChange, placeholder = 'Search a person…', emptyLabel = '— None —',
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = candidates.find((c) => c.id === value)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = candidates.filter((c) => !c.vacant)
    if (!q) return pool.slice(0, 8)
    return pool
      .filter((c) => c.name.toLowerCase().includes(q) || c.designation.toLowerCase().includes(q))
      .slice(0, 8)
  }, [candidates, query])

  if (selected) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 text-[10px] font-semibold text-teal-600">
          {initials(selected.name)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{selected.name} · {selected.designation}</span>
        <button type="button" onClick={() => onChange('')} className="text-muted hover:text-ink-900" aria-label="Clear selection">
          <Icon name="X" size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 focus:border-ink-600 focus-visible:focus-ring"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-white shadow-pop">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(''); setOpen(false) }}
            className="flex w-full items-center px-3 py-2 text-left text-sm text-muted hover:bg-ink-900/[0.04]"
          >
            {emptyLabel}
          </button>
          <div className="max-h-48 overflow-y-auto scrollbar-thin">
            {matches.length === 0 && <div className="px-3 py-2 text-sm text-muted">No matches</div>}
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(c.id); setQuery(''); setOpen(false) }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-900/[0.04]"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{c.name}</span>
                <span className="shrink-0 truncate text-xs text-muted">{c.designation}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

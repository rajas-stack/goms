import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import type { HierNode } from '@/lib/types'

interface Props {
  departments: HierNode[]
  value: string | null
  onSelect: (id: string) => void
  placeholder?: string
  className?: string
}

/** Compact searchable department picker for the canvas overlays. Type to
 *  filter every department in the current state; picking one drives selection
 *  in the shared workspace context. Reused by both the People view (keeps the
 *  reporting tree in sync) and the Organization canvas (centers on the match). */
export function DepartmentCombobox({ departments, value, onSelect, placeholder, className }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = departments.find((d) => d.id === value) ?? null

  const matches = useMemo(() => {
    const q = (open ? query : '').trim().toLowerCase()
    const list = q ? departments.filter((d) => d.name.toLowerCase().includes(q)) : departments
    return list.slice(0, 50)
  }, [departments, query, open])

  useEffect(() => setActive(0), [query, open])

  function choose(id: string) {
    onSelect(id)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[active]) choose(matches[active].id) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  return (
    <div data-canvas-ui className={cn('pointer-events-auto relative', className)}>
      <div className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-white px-2">
        <Icon name="Search" size={13} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={open ? query : selected?.name ?? ''}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          disabled={departments.length === 0}
          placeholder={departments.length === 0 ? 'No departments yet' : placeholder ?? 'Search departments…'}
          className="h-full w-[10rem] bg-transparent text-[12px] font-semibold text-ink-900 outline-none placeholder:font-normal placeholder:text-muted/70"
        />
      </div>

      {open && matches.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-[16rem] overflow-y-auto scrollbar-thin rounded-lg border border-line bg-white shadow-pop">
          {matches.map((d, i) => (
            <button
              key={d.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(d.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                i === active ? 'bg-ink-900/[0.06]' : 'hover:bg-ink-900/[0.03]',
                d.id === value ? 'font-semibold text-ink-900' : 'text-ink-800',
              )}
            >
              <Icon name="Landmark" size={13} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              {d.id === value && <Icon name="Check" size={13} className="shrink-0 text-teal-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { useRovingIndex } from '@/components/ui/popover/useRovingIndex'
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
  const anchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = departments.find((d) => d.id === value) ?? null

  const matches = useMemo(() => {
    const q = (open ? query : '').trim().toLowerCase()
    const list = q ? departments.filter((d) => d.name.toLowerCase().includes(q)) : departments
    return list.slice(0, 50)
  }, [departments, query, open])

  function choose(id: string) {
    onSelect(id)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const roving = useRovingIndex({
    count: matches.length,
    resetKey: `${query}:${open}`,
    onCommit: (i) => { const m = matches[i]; if (m) choose(m.id) },
    containerRef: listRef,
  })

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    roving.onKeyDown(e)
  }

  return (
    <div data-canvas-ui className={cn('pointer-events-auto relative', className)}>
      <div ref={anchorRef} className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-white px-2">
        <Icon name="Search" size={13} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={open ? query : selected?.name ?? ''}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onKeyDown={onKeyDown}
          disabled={departments.length === 0}
          placeholder={departments.length === 0 ? 'No departments yet' : placeholder ?? 'Search departments…'}
          className="h-full w-[10rem] bg-transparent text-[12px] font-semibold text-ink-900 outline-none placeholder:font-normal placeholder:text-muted/70"
        />
      </div>

      <PopoverPanel open={open && matches.length > 0} anchorRef={anchorRef} onClose={() => setOpen(false)} maxPanelHeight={256}>
        {() => (
          <div
            ref={listRef}
            data-canvas-ui
            className="w-[16rem] overflow-y-auto scrollbar-thin rounded-lg border border-line bg-white shadow-pop"
          >
            {matches.map((d, i) => (
              <button
                key={d.id}
                type="button"
                data-roving-index={i}
                onClick={() => choose(d.id)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors lg:min-h-0',
                  i === roving.active ? 'bg-ink-900/[0.06]' : 'hover:bg-ink-900/[0.03]',
                  d.id === value ? 'font-semibold text-ink-900' : 'text-ink-800',
                )}
              >
                <Icon name="Landmark" size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 break-words">{d.name}</span>
                {d.id === value && <Icon name="Check" size={13} className="shrink-0 text-teal-600" />}
              </button>
            ))}
          </div>
        )}
      </PopoverPanel>
    </div>
  )
}

import { useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import type { Employee } from '@/lib/types'

interface Props {
  candidates: Employee[]
  value: string
  onChange: (id: string) => void
  onCreate: (name: string) => Promise<string>
  createLabel?: (name: string) => string
  placeholder?: string
  onQueryChange?: (query: string) => void
}

/** Search-or-create manager combobox: type to filter existing peers, or
 *  create a brand-new manager inline when no match exists. Replaces the
 *  plain <select> so a reporting manager never has to already exist. */
export function ManagerPicker({ candidates, value, onChange, onCreate, placeholder, createLabel, onQueryChange }: Props) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = candidates.find((c) => c.id === value)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates.slice(0, 8)
    return candidates.filter((c) => c.name.toLowerCase().includes(q) || c.designation.toLowerCase().includes(q)).slice(0, 8)
  }, [candidates, query])

  const exactMatch = candidates.some((c) => c.name.toLowerCase() === query.trim().toLowerCase())

  async function createAndSelect() {
    const name = query.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const id = await onCreate(name)
      onChange(id)
      setQuery('')
      setOpen(false)
    } catch {
      toast('Could not create that manager — try again')
    } finally {
      setCreating(false)
    }
  }

  if (selected) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 text-[10px] font-semibold text-teal-600">
          {selected.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{selected.name} · {selected.designation}</span>
        <button type="button" onClick={() => onChange('')} className="text-muted hover:text-ink-900" aria-label="Clear reporting manager">
          <Icon name="X" size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onQueryChange?.(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder ?? "Search or type a new manager’s name…"}
        className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 focus:border-ink-600 focus-visible:focus-ring"
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-white shadow-pop">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange('')}
            className="flex w-full items-center px-3 py-2 text-left text-sm text-muted hover:bg-ink-900/[0.04]"
          >
            — None (top of chain) —
          </button>
          <div className="max-h-48 overflow-y-auto scrollbar-thin">
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(c.id); setQuery('') }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-900/[0.04]"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{c.name}</span>
                <span className="shrink-0 truncate text-xs text-muted">{c.designation}</span>
              </button>
            ))}
          </div>
          {query.trim() && !exactMatch && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={createAndSelect}
              disabled={creating}
              className={cn(
                'flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm font-medium text-teal-600 hover:bg-teal-100/40',
                creating && 'opacity-60',
              )}
            >
              <Icon name="UserPlus" size={14} />
              {creating ? 'Creating…' : createLabel ? createLabel(query.trim()) : `Create new manager “${query.trim()}”`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

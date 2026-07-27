import { useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { useRovingIndex } from '@/components/ui/popover/useRovingIndex'
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
  const anchorRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = candidates.find((c) => c.id === value)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates.slice(0, 8)
    return candidates.filter((c) => c.name.toLowerCase().includes(q) || c.designation.toLowerCase().includes(q)).slice(0, 8)
  }, [candidates, query])

  const exactMatch = candidates.some((c) => c.name.toLowerCase() === query.trim().toLowerCase())
  const showCreateRow = query.trim() !== '' && !exactMatch
  // Row order: [0] "None" sentinel, [1..matches.length] the candidates, then
  // an optional trailing "Create new…" row — fixed so the roving index lines
  // up with what's actually rendered.
  const rowCount = 1 + matches.length + (showCreateRow ? 1 : 0)

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

  function commitRow(index: number) {
    if (index === 0) { onChange(''); setOpen(false); return }
    const candidateIndex = index - 1
    if (candidateIndex < matches.length) {
      onChange(matches[candidateIndex].id)
      setQuery('')
      setOpen(false)
      return
    }
    createAndSelect()
  }

  const roving = useRovingIndex({
    count: rowCount,
    resetKey: `${query}:${open}`,
    onCommit: commitRow,
    containerRef: listRef,
  })

  if (selected) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 text-[10px] font-semibold text-teal-600">
          {selected.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
        </span>
        <span className="min-w-0 flex-1 break-words text-sm text-ink-900">{selected.name} · {selected.designation}</span>
        <button type="button" onClick={() => onChange('')} className="text-muted hover:text-ink-900" aria-label="Clear reporting manager">
          <Icon name="X" size={14} />
        </button>
      </div>
    )
  }

  return (
    <div ref={anchorRef} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onQueryChange?.(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => roving.onKeyDown(e)}
        placeholder={placeholder ?? "Search or type a new manager’s name…"}
        className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 focus:border-ink-600 focus-visible:focus-ring"
      />
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} matchAnchorWidth maxPanelHeight={320}>
        {() => (
          <div ref={listRef} className="w-full overflow-hidden rounded-lg border border-line bg-white shadow-pop">
            <button
              type="button"
              data-roving-index={0}
              onClick={() => commitRow(0)}
              className={cn(
                'flex min-h-11 w-full items-center px-3 py-2 text-left text-sm text-muted hover:bg-ink-900/[0.04] lg:min-h-0',
                roving.active === 0 && 'bg-ink-900/[0.04]',
              )}
            >
              — None (top of chain) —
            </button>
            <div className="max-h-48 overflow-y-auto scrollbar-thin">
              {matches.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  data-roving-index={i + 1}
                  onClick={() => commitRow(i + 1)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-900/[0.04] lg:min-h-0',
                    roving.active === i + 1 && 'bg-ink-900/[0.04]',
                  )}
                >
                  <span className="min-w-0 flex-1 break-words text-sm text-ink-900">{c.name}</span>
                  <span className="shrink-0 break-words text-xs text-muted">{c.designation}</span>
                </button>
              ))}
            </div>
            {showCreateRow && (
              <button
                type="button"
                data-roving-index={1 + matches.length}
                onClick={() => commitRow(1 + matches.length)}
                disabled={creating}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm font-medium text-teal-600 hover:bg-teal-100/40 lg:min-h-0',
                  roving.active === 1 + matches.length && 'bg-teal-100/40',
                  creating && 'opacity-60',
                )}
              >
                <Icon name="UserPlus" size={14} />
                {creating ? 'Creating…' : createLabel ? createLabel(query.trim()) : `Create new manager “${query.trim()}”`}
              </button>
            )}
          </div>
        )}
      </PopoverPanel>
    </div>
  )
}

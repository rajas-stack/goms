import { useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { useRovingIndex } from '@/components/ui/popover/useRovingIndex'
import { cn, initials } from '@/lib/utils'
import type { Employee } from '@/lib/types'

interface Props {
  candidates: Employee[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  emptyLabel?: string
  /** When provided, typing a name with no match offers an inline "create new
   *  person" form (name + designation) instead of staying select-only. */
  onCreate?: (name: string, designation: string) => Promise<string>
  createLabel?: (name: string) => string
}

/** Searchable person picker. Select-only by default (candidates already in the
 *  system — sales ownership, transfer targets, etc); pass `onCreate` to also
 *  allow adding someone who isn't in the roster yet, capturing their
 *  designation inline. Mirrors ManagerPicker's look. */
export function EmployeePicker({
  candidates, value, onChange, placeholder = 'Search a person…', emptyLabel = '— None —',
  onCreate, createLabel,
}: Props) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDesignation, setFormDesignation] = useState('')
  const [creating, setCreating] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = candidates.find((c) => c.id === value)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = candidates.filter((c) => !c.vacant)
    if (!q) return pool.slice(0, 8)
    return pool
      .filter((c) => c.name.toLowerCase().includes(q) || c.designation.toLowerCase().includes(q))
      .slice(0, 8)
  }, [candidates, query])

  const exactMatch = candidates.some((c) => c.name.trim().toLowerCase() === query.trim().toLowerCase())
  const showCreateRow = !!onCreate && query.trim() !== '' && !exactMatch
  const rowCount = formOpen ? 0 : 1 + matches.length + (showCreateRow ? 1 : 0)

  function openCreateForm() {
    setFormName(query.trim())
    setFormDesignation('')
    setFormOpen(true)
  }

  async function submitCreate() {
    const name = formName.trim()
    const designation = formDesignation.trim()
    if (!name || !designation || !onCreate || creating) return
    setCreating(true)
    try {
      const id = await onCreate(name, designation)
      onChange(id)
      setQuery('')
      setFormOpen(false)
      setOpen(false)
    } catch {
      toast('Could not create that person — try again')
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
    openCreateForm()
  }

  const roving = useRovingIndex({
    count: rowCount,
    resetKey: `${query}:${open}:${formOpen}`,
    onCommit: commitRow,
    containerRef: listRef,
  })

  function close() {
    setOpen(false)
    setFormOpen(false)
  }

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
    <div ref={anchorRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (!formOpen) roving.onKeyDown(e) }}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 focus:border-ink-600 focus-visible:focus-ring"
      />
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={close} matchAnchorWidth maxPanelHeight={420}>
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
              {emptyLabel}
            </button>
            <div className="max-h-48 overflow-y-auto scrollbar-thin">
              {matches.length === 0 && <div className="px-3 py-2 text-sm text-muted">No matches</div>}
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
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{c.name}</span>
                  <span className="shrink-0 truncate text-xs text-muted">{c.designation}</span>
                </button>
              ))}
            </div>
            {showCreateRow && (
              formOpen ? (
                <div className="space-y-2 border-t border-line p-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Name</label>
                    <input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      autoFocus
                      className="h-8 w-full rounded-md border border-line bg-white px-2 text-sm text-ink focus:border-ink-600 focus-visible:focus-ring"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Designation</label>
                    <input
                      value={formDesignation}
                      onChange={(e) => setFormDesignation(e.target.value)}
                      placeholder="e.g. Principal Secretary"
                      className="h-8 w-full rounded-md border border-line bg-white px-2 text-sm text-ink focus:border-ink-600 focus-visible:focus-ring"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setFormOpen(false)}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-muted hover:text-ink-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitCreate}
                      disabled={!formName.trim() || !formDesignation.trim() || creating}
                      className={cn(
                        'rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700',
                        (!formName.trim() || !formDesignation.trim() || creating) && 'opacity-50',
                      )}
                    >
                      {creating ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-roving-index={1 + matches.length}
                  onClick={() => commitRow(1 + matches.length)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm font-medium text-teal-600 hover:bg-teal-100/40 lg:min-h-0',
                    roving.active === 1 + matches.length && 'bg-teal-100/40',
                  )}
                >
                  <Icon name="UserPlus" size={14} />
                  {createLabel ? createLabel(query.trim()) : `Create new person “${query.trim()}”`}
                </button>
              )
            )}
          </div>
        )}
      </PopoverPanel>
    </div>
  )
}

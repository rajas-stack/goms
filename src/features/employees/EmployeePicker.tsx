import { useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { useRovingIndex } from '@/components/ui/popover/useRovingIndex'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
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
  /** A staged person whose record will be created by the owning form after its
   *  parent entity exists; lets that selection survive draft restoration. */
  pendingSelection?: { id: string; name: string; designation: string } | null
  createLabel?: (name: string) => string
  /** Include vacant seats (title, no incumbent) as selectable rows. Off by
   *  default — most callers (sales ownership, transfer targets) need a real
   *  person, not an empty seat. Turn on for pickers where the seat's
   *  designation itself is the thing being selected, e.g. a government
   *  stakeholder contact that's still unfilled. */
  includeVacant?: boolean
  /** When set, shown as an inline warning beneath the input — and the input
   *  is given a visually distinct (amber) border — whenever the user has
   *  typed something but not yet selected a match or finished the "create
   *  new person" flow. Opt-in and undefined by default so existing callers
   *  (sales ownership, transfer targets, etc.) see no visual change; a
   *  caller for whom a confirmed selection is required (e.g. a required
   *  stakeholder contact) passes this to make that unconfirmed state
   *  unmistakable rather than looking like a saved value. */
  unconfirmedHint?: string
}

/** Displayed name for a candidate row — a vacant seat has no `name`, so it
 *  falls back to its designation, matching the convention used elsewhere
 *  (`repository.ts`, `search-categories.ts`, `EmployeeDetails.tsx`). */
function personLabel(c: Employee): string {
  return c.vacant ? (c.designation || 'Vacant position') : c.name
}

/** Searchable person picker. Select-only by default (candidates already in the
 *  system — sales ownership, transfer targets, etc); pass `onCreate` to also
 *  allow adding someone who isn't in the roster yet, capturing their
 *  designation inline. Mirrors ManagerPicker's look. */
export function EmployeePicker({
  candidates, value, onChange, placeholder = 'Search a person…', emptyLabel = '— None —',
  onCreate, createLabel, includeVacant = false, unconfirmedHint, pendingSelection,
}: Props) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDesignation, setFormDesignation] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdSelection, setCreatedSelection] = useState<{ id: string; name: string; designation: string } | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = candidates.find((c) => c.id === value)
  const localSelection = createdSelection?.id === value
    ? createdSelection
    : pendingSelection?.id === value ? pendingSelection : null

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = includeVacant ? candidates : candidates.filter((c) => !c.vacant)
    if (!q) return pool.slice(0, 8)
    return pool
      .filter((c) => personLabel(c).toLowerCase().includes(q) || c.designation.toLowerCase().includes(q))
      .slice(0, 8)
  }, [candidates, query, includeVacant])

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
      setCreatedSelection({ id, name, designation })
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

  if (selected || localSelection) {
    const name = selected?.name ?? localSelection!.name
    const photoUrl = selected?.photoUrl ?? null
    const vacant = selected?.vacant ?? false
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5">
        <Avatar person={{ name, photoUrl, vacant }} size="xs" />
        <span className="min-w-0 flex-1 break-words text-sm text-ink-900">
          {selected?.vacant ? <>{personLabel(selected)} <span className="text-muted">· Vacant</span></> : <>{name} · {selected?.designation ?? localSelection!.designation}</>}
        </span>
        <button type="button" onClick={() => onChange('')} className="text-muted hover:text-ink-900" aria-label="Clear selection">
          <Icon name="X" size={14} />
        </button>
      </div>
    )
  }

  const hasUnconfirmedText = !!unconfirmedHint && query.trim() !== ''

  return (
    <div>
    <div ref={anchorRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (!formOpen) roving.onKeyDown(e) }}
        placeholder={placeholder}
        aria-invalid={hasUnconfirmedText}
        className={cn(
          'h-10 w-full rounded-lg border bg-white px-3 text-sm text-ink placeholder:text-muted/70 focus:border-ink-600 focus-visible:focus-ring',
          hasUnconfirmedText ? 'border-amber-400' : 'border-line',
        )}
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
                  <Avatar person={{ name: c.name, photoUrl: c.photoUrl, vacant: c.vacant }} size="xs" />
                  <span className="min-w-0 flex-1 break-words text-sm text-ink-900">{personLabel(c)}</span>
                  <span className="shrink-0 break-words text-xs text-muted">{c.vacant ? 'Vacant' : c.designation}</span>
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
    {hasUnconfirmedText && <p className="mt-1 text-[12px] text-amber-700">{unconfirmedHint}</p>}
    </div>
  )
}

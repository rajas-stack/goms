import { useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { sameDepartment } from '@goms/domain'
import { cn } from '@/lib/utils'

interface Props {
  value: readonly string[]
  /** The Amnex Departments master names, in display order. */
  options: readonly string[]
  onChange: (next: string[]) => void
  /** Creates a department in the master and resolves its stored name; omitted hides "+ Create department". */
  onCreate?: (name: string) => Promise<string>
  disabled?: boolean
  'aria-label': string
  /** How many chips show before "+N". */
  maxChips?: number
  placeholder?: string
}

/** Compact multi-select for departments: chips (then "+N") on the trigger, a checkbox list in the popover, and a
 *  "+ Create department" footer that adds to the master and selects it. */
export function DepartmentMultiSelect({
  value, options, onChange, onCreate, disabled, 'aria-label': ariaLabel, maxChips = 2, placeholder = 'No department',
}: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Values not (or no longer) in the master still show, so nobody's department silently disappears from view.
  const all = [...options, ...value.filter((v) => !options.some((o) => sameDepartment(o, v)))]
  const q = query.trim().toLowerCase()
  const shown = all.filter((o) => !q || o.toLowerCase().includes(q))
  const exact = all.some((o) => sameDepartment(o, query))
  const has = (d: string) => value.some((v) => sameDepartment(v, d))
  const toggle = (d: string) => onChange(has(d) ? value.filter((v) => !sameDepartment(v, d)) : [...value, d])

  const close = () => { setOpen(false); setQuery(''); setError(null) }
  const create = async () => {
    if (!onCreate || !query.trim()) return
    setCreating(true)
    setError(null)
    try {
      const name = await onCreate(query)
      if (!has(name)) onChange([...value, name])
      setQuery('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the department.')
    } finally {
      setCreating(false)
    }
  }

  const chips = value.slice(0, maxChips)
  const more = value.length - chips.length
  return (
    <>
      <button
        ref={anchorRef} type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex min-h-8 w-full max-w-[16rem] items-center gap-1 rounded-lg border border-line bg-white px-1.5 py-1 text-left text-[12px] transition-colors hover:border-ink-600/30 focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {value.length === 0 && <span className="px-1 text-muted">{placeholder}</span>}
          {chips.map((d) => (
            <span key={d} className="truncate rounded-full border border-goms-navy/25 bg-goms-navy/[0.07] px-1.5 py-px text-[11px] font-medium text-goms-navy">{d}</span>
          ))}
          {more > 0 && <span className="rounded-full bg-panel px-1.5 py-px text-[11px] font-medium text-ink-700" title={value.slice(maxChips).join(', ')}>+{more}</span>}
        </span>
        <Icon name="ChevronDown" size={13} className="shrink-0 text-muted" />
      </button>
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={close} maxPanelHeight={320}>
        {({ maxHeight }) => (
          <div style={{ maxHeight }} className="flex w-60 flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-pop">
            <div className="border-b border-line p-1.5">
              <input
                autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or name a new department…"
                aria-label="Search departments"
                onKeyDown={(e) => { if (e.key === 'Enter' && !exact && onCreate) { e.preventDefault(); void create() } }}
                className="h-8 w-full rounded-lg border border-line bg-white px-2 text-[12.5px] outline-none focus-visible:focus-ring"
              />
            </div>
            <ul role="listbox" aria-multiselectable="true" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1 scrollbar-thin">
              {shown.map((d) => (
                <li key={d}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-ink hover:bg-ink-900/[0.05]">
                    <input type="checkbox" checked={has(d)} onChange={() => toggle(d)} className="h-3.5 w-3.5 accent-ink-900" />
                    <span className="truncate">{d}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-muted">No department matches.</li>}
            </ul>
            {error && <p role="alert" className="px-2.5 pb-1 text-[11.5px] text-crimson">{error}</p>}
            {onCreate && (
              <button
                type="button" disabled={!query.trim() || exact || creating} onClick={() => void create()}
                className={cn('flex items-center gap-1.5 border-t border-line px-2.5 py-2 text-left text-[12.5px] font-medium text-goms-navy hover:bg-goms-navy/[0.05]',
                  'disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent')}
              >
                <Icon name="Plus" size={13} />
                {query.trim() && !exact ? `Create department “${query.trim()}”` : 'Create department (type a name above)'}
              </button>
            )}
          </div>
        )}
      </PopoverPanel>
    </>
  )
}

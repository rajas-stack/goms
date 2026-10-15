import { useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { cn } from '@/lib/utils'
import { matchesEmployee, normalizeEmailKey, type MasterEmployee } from '@/features/org/masterEmployees'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  /** Already filtered by the dialog's departments and levels. */
  employees: readonly MasterEmployee[]
  /** Everyone, to name selected users who are outside the current filter. */
  allEmployees: readonly MasterEmployee[]
  /** Selected user ids (lower-cased emails). */
  value: readonly string[]
  onChange: (next: string[]) => void
}

/** Searchable multi-select of employees for "Apply template": checkbox rows (avatar, name, designation, level,
 *  departments), "Select all (N shown)" / "Clear", selected people as chips, and "Add by email" for anyone else. */
export function EmployeeMultiPicker({ employees, allEmployees, value, onChange }: Props) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [email, setEmail] = useState('')
  const shown = employees.filter((e) => matchesEmployee(e, query))
  const selectable = shown.flatMap((e) => (e.email ? [normalizeEmailKey(e.email)] : []))
  const has = (id: string) => value.includes(id)
  const toggle = (id: string) => onChange(has(id) ? value.filter((v) => v !== id) : [...value, id])
  const nameOf = (id: string) => allEmployees.find((e) => normalizeEmailKey(e.email) === id)?.name ?? id
  const typed = normalizeEmailKey(email)
  const addEmail = () => { if (EMAIL.test(typed) && !has(typed)) onChange([...value, typed]); setEmail('') }

  return (
    <div className="space-y-2">
      <div ref={anchorRef} className="relative">
        <Icon name="Search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <Input
          aria-label="Search employees" placeholder={`Search ${employees.length} employee${employees.length === 1 ? '' : 's'}…`} value={query}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          className="h-9 pl-8"
        />
      </div>
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} matchAnchorWidth maxPanelHeight={300}>
        {({ maxHeight }) => (
          <div style={{ maxHeight }} className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-pop">
            <div className="flex items-center gap-2 border-b border-line px-2 py-1.5 text-[12px]">
              <button type="button" disabled={selectable.length === 0} onClick={() => onChange([...new Set([...value, ...selectable])])}
                className="font-medium text-goms-navy hover:underline disabled:text-muted disabled:no-underline">
                Select all ({selectable.length} shown)
              </button>
              <span className="text-line">|</span>
              <button type="button" disabled={value.length === 0} onClick={() => onChange([])}
                className="font-medium text-ink-700 hover:underline disabled:text-muted disabled:no-underline">Clear</button>
              <button type="button" aria-label="Close employee list" onClick={() => setOpen(false)} className="ml-auto text-muted hover:text-ink-900"><Icon name="X" size={12} /></button>
            </div>
            <ul role="listbox" aria-multiselectable="true" aria-label="Employees" className="min-h-0 flex-1 overflow-y-auto p-1 scrollbar-thin">
              {shown.map((e) => {
                const id = normalizeEmailKey(e.email)
                return (
                  <li key={e.key}>
                    <label className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]', id ? 'cursor-pointer hover:bg-ink-900/[0.05]' : 'cursor-not-allowed opacity-55')}
                      title={id ? e.email : 'Add an email in Teams → Employees first'}>
                      <input type="checkbox" aria-label={e.name} disabled={!id} checked={!!id && has(id)} onChange={() => toggle(id)} className="h-3.5 w-3.5 accent-ink-900" />
                      <Avatar person={e} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink-900">
                          {e.name}{e.level !== null && <span className="ml-1.5 text-[11px] font-semibold text-muted">L{e.level}</span>}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted">
                          {id ? [e.designation, e.departments.join(', ')].filter(Boolean).join(' · ') || e.email : 'needs an email'}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
              {shown.length === 0 && <li className="px-2 py-4 text-center text-[12px] text-muted">Nobody matches these filters.</li>}
            </ul>
          </div>
        )}
      </PopoverPanel>
      {value.length > 0 && (
        <ul aria-label="Selected users" className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {value.map((id) => (
            <li key={id} className="flex items-center gap-1 rounded-full border border-line bg-white py-0.5 pl-1 pr-1.5 text-[12px] text-ink-800" title={id}>
              <Avatar person={{ name: nameOf(id) }} size="2xs" />
              {nameOf(id)}
              <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => toggle(id)} className="text-muted hover:text-ink-900"><Icon name="X" size={11} /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); addEmail() }}>
        <Input aria-label="Add by email" type="email" placeholder="Not listed? Add by email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-8 text-[12.5px]" />
        <Button type="submit" size="sm" variant="secondary" disabled={!EMAIL.test(typed)}>Add</Button>
      </form>
    </div>
  )
}

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { coerceCustomValue, parseMultiValue } from '@goms/domain'
import { Checkbox } from '@/components/ui/Checkbox'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { NO_LOOKUPS, isEmptyCell, optionsOf, type ColumnOption, type EntityLookups, type GridColumnMeta } from '../gridColumns'

export type CellDraft = string | number | boolean | null

/** Open editors holding a change that is not saved yet, keyed by cell. The grid
 *  reads this when asked to lock: a pending edit must be saved or discarded first. */
export type PendingEdits = MutableRefObject<Map<string, { discard: () => void }>>

// The editor sits exactly on top of the cell, like a spreadsheet's in-cell editor:
// it covers the cell border with a 2px accent outline and never changes row height.
const input = 'absolute inset-0 z-20 h-[35px] w-full rounded-none border-2 bg-white px-2 text-[12.5px] text-ink shadow-[0_2px_8px_rgba(11,43,73,0.22)] outline-none'

/** Raw text for a type's editor, from the stored value. */
function draftOf(type: string, value: unknown): string {
  if (isEmptyCell(value)) return ''
  if (type === 'multiselect') return JSON.stringify(parseMultiValue(value))
  return String(value)
}

/** One inline-editable grid cell (Excel-style): click / Enter / F2 to edit,
 *  Enter or blur to commit, Esc to cancel. Only ever rendered for columns the
 *  registry marks `editable`, and only while the grid is unlocked —
 *  protected / corrigendum-tracked fields never get one. Validation for a custom
 *  column uses the same `coerceCustomValue` the API applies, so a value rejected
 *  here is a value the API would reject; an invalid draft keeps the editor open
 *  with the message inline. `externalError` is a server-side rejection that
 *  rolled the cell back after commit. Entity columns (person, department,
 *  state) edit as a pick-list of the live records and store the record's id. */
export function EditableCell({ col, value, display, externalError, onCommit, lookups = NO_LOOKUPS, pending, cellKey }: {
  col: GridColumnMeta
  value: unknown
  display: ReactNode
  externalError?: string
  onCommit: (value: CellDraft) => void
  lookups?: EntityLookups
  pending?: PendingEdits
  cellKey?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)
  const cancelled = useRef(false)
  const displayRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  // After Enter / Escape / blur-commit the editor unmounts; focus goes back to
  // the cell so the keyboard user keeps their place (F2 / Enter edits again).
  const refocus = useRef(false)
  // Enter unmounts the input, which some browsers report as a blur — without
  // this guard that would commit the same edit twice.
  const done = useRef(false)

  const type = col.type ?? 'text'
  const current = draftOf(type, value)
  const options = optionsOf(col, lookups)
  // A stored select value that is no longer one of the field's options stays
  // visible (and selectable as-is) but is tagged, so a removed option never
  // silently disappears from a cell.
  const removedOption = type === 'select' && current !== '' && !options.some((o) => o.value === current)
  const dirty = editing && draft !== current

  useEffect(() => {
    if (editing && type !== 'multiselect') inputRef.current?.focus()
    else if (editing) editorRef.current?.focus()
    else if (refocus.current) { refocus.current = false; displayRef.current?.focus() }
  }, [editing, type])

  const cancel = () => {
    cancelled.current = true
    refocus.current = true
    setEditing(false)
    setError(null)
  }

  // Report an unsaved edit to the grid (so Lock can refuse to drop it) for as long as it exists.
  useEffect(() => {
    if (!pending || !cellKey || !dirty) return
    pending.current.set(cellKey, { discard: cancel })
    return () => { pending.current.delete(cellKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, cellKey, pending])

  const start = (seed?: string) => {
    cancelled.current = false
    done.current = false
    setDraft(seed ?? current)
    setError(null)
    setEditing(true)
  }
  // Spreadsheet habit: typing on a selected cell replaces its value (free-text editors only).
  const typesFreely = !(col.pick || ['select', 'boolean', 'state', 'person', 'department', 'multiselect', 'date'].includes(type))

  const commit = (raw: string) => {
    if (cancelled.current || done.current) return
    let next: CellDraft
    try {
      if (col.custom) next = coerceCustomValue(col.custom.dataType, raw, col.custom.options)
      else if (raw.trim() === '') {
        if (col.required) throw new Error(`${col.header} is required.`)
        next = null
      } else next = raw.trim()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid value.')
      return
    }
    done.current = true
    refocus.current = document.activeElement === inputRef.current || document.activeElement === editorRef.current
    setEditing(false)
    setError(null)
    // No-op edits are not writes (and not audit entries).
    if ((next === null ? '' : String(next)) === current) return
    onCommit(next)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
    else if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  if (!editing) {
    return (
      <div
        ref={displayRef}
        role="button" tabIndex={0} aria-label={`Edit ${col.header}`}
        title={externalError ?? 'Click to edit'}
        data-editable-cell
        className={cn(
          // Each editable cell reads as its own box while unlocked; the active
          // (focused) cell gets the spreadsheet's 2px selection rectangle.
          'flex h-[35px] w-full min-w-0 cursor-cell items-center gap-1 px-3 outline-none',
          'shadow-[inset_0_0_0_1px_rgba(76,167,221,0.35)] hover:shadow-[inset_0_0_0_1px_rgba(76,167,221,0.95)]',
          'focus:shadow-[inset_0_0_0_2px_#0B2B49] focus:bg-[#F2F8FD]',
          externalError && 'text-crimson shadow-[inset_0_0_0_1px_#B23A48]',
        )}
        onClick={(e) => { e.stopPropagation(); start() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); e.stopPropagation(); start() }
          else if (typesFreely && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); start(e.key) }
          else if ((e.key === 'Delete' || e.key === 'Backspace') && !col.required && typesFreely) { e.preventDefault(); e.stopPropagation(); start(''); }
        }}
      >
        <span className="min-w-0 flex-1 truncate">{display}</span>
        {externalError && <span className="shrink-0 text-[11px]">{externalError}</span>}
      </div>
    )
  }

  const borderClass = error ? 'border-crimson' : 'border-goms-navy'
  let editor: ReactNode
  if (type === 'multiselect') {
    const chosen = new Set(parseMultiValue(draft))
    const toggle = (v: string) => {
      const next = new Set(chosen)
      if (next.has(v)) next.delete(v); else next.add(v)
      setDraft(JSON.stringify(options.map((o) => o.value).filter((o) => next.has(o))))
      if (error) setError(null)
    }
    editor = (
      <div
        ref={editorRef} tabIndex={-1} role="group" aria-label={col.header}
        className={cn(input, borderClass, 'flex items-center truncate')}
        onKeyDown={onKeyDown}
      >
        <span className="truncate">{[...chosen].join(', ') || <span className="text-muted">Choose…</span>}</span>
        <PopoverPanel open anchorRef={editorRef} onClose={() => commit(draft)} maxPanelHeight={260}>
          {({ maxHeight }) => (
            <motion.div
              data-canvas-ui initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.1 }}
              style={{ maxHeight }} role="listbox" aria-label={`${col.header} options`} aria-multiselectable
              onKeyDown={onKeyDown}
              className="w-60 overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper p-1 shadow-pop"
            >
              {options.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink hover:bg-goms-sky/[0.14]">
                  <Checkbox aria-label={o.label} checked={chosen.has(o.value)} onChange={() => toggle(o.value)} />
                  {o.label}
                </label>
              ))}
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-paper px-1 pt-1">
                <button type="button" className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-goms-sky/[0.14]" onClick={cancel}>Cancel</button>
                <button type="button" className="rounded-md bg-goms-navy px-2 py-1 text-[12px] text-paper" onClick={() => commit(draft)}>Done</button>
              </div>
            </motion.div>
          )}
        </PopoverPanel>
      </div>
    )
  } else if (col.pick || type === 'select' || type === 'boolean' || type === 'state' || type === 'person' || type === 'department') {
    const choices = type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : options
    editor = (
      <CellPicker
        label={col.header} options={choices} value={draft} borderClass={borderClass}
        allowClear={!col.required} removed={removedOption ? current : null}
        onPick={(v) => { setDraft(v); commit(v) }} onCancel={cancel}
      />
    )
  } else {
    const numeric = type === 'number' || type === 'currency'
    editor = (
      <input
        aria-label={col.header} className={cn(input, borderClass)} value={draft}
        type={numeric ? 'number' : type === 'date' ? 'date' : 'text'} step={numeric ? 'any' : undefined}
        inputMode={type === 'email' ? 'email' : type === 'phone' ? 'tel' : type === 'url' ? 'url' : undefined}
        placeholder={type === 'url' ? 'https://…' : type === 'email' ? 'name@example.com' : type === 'phone' ? '+91 …' : undefined}
        ref={(el) => { inputRef.current = el }}
        onChange={(e) => { setDraft(e.target.value); if (error) setError(null) }}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
    )
  }

  return (
    <div className="relative h-[35px] w-full" onClick={(e) => e.stopPropagation()}>
      {editor}
      {error && (
        <p role="alert" className="absolute left-0 top-full z-30 mt-0.5 whitespace-nowrap rounded bg-crimson px-1.5 py-0.5 text-[11px] text-white shadow-pop">{error}</p>
      )}
    </div>
  )
}

/** A Notion-style pick-list for a cell: click the cell, search, click an option. The
 *  list is the live GOMS records (sales people, departments, states) or the
 *  column's own options. Escape or clicking away cancels. */
function CellPicker({ label, options, value, borderClass, allowClear, removed, onPick, onCancel }: {
  label: string
  options: ColumnOption[]
  value: string
  borderClass: string
  allowClear: boolean
  /** A stored value that is no longer one of the options (shown, tagged, pickable as-is). */
  removed: string | null
  onPick: (value: string) => void
  onCancel: () => void
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rows = [
    ...(allowClear ? [{ value: '', label: '— Clear' }] : []),
    ...(removed ? [{ value: removed, label: removed + ' (removed option)' }] : []),
    ...options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())),
  ]
  const shownOption = options.find((o) => o.value === value)
  const shown = shownOption?.label ?? (removed && value === removed ? removed : '')
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) onPick(rows[active].value) }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }
  return (
    <div ref={anchorRef} className={cn(input, borderClass, 'flex items-center gap-1.5 truncate')}>
      {shownOption?.isPerson && <Avatar person={{ name: shownOption.label, photoUrl: shownOption.photoUrl }} size="xs" />}
      <span className="min-w-0 flex-1 truncate">{shown || <span className="text-muted">Choose…</span>}</span>
      <Icon name="ChevronDown" size={13} className="shrink-0 text-muted" />
      <PopoverPanel open anchorRef={anchorRef} onClose={onCancel} maxPanelHeight={300}>
        {({ maxHeight }) => (
          <motion.div
            data-canvas-ui initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.1 }}
            style={{ maxHeight }} className="flex w-64 flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-pop"
          >
            <div className="border-b border-line p-1.5">
              <input
                autoFocus aria-label={'Search ' + label} placeholder="Search…" value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0) }} onKeyDown={onKeyDown}
                className="h-8 w-full rounded-md border border-line bg-white px-2 text-[13px] text-ink outline-none focus-visible:focus-ring"
              />
            </div>
            <ul role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-1">
              {rows.length === 0 && <li className="px-2 py-1.5 text-[13px] text-muted">No match</li>}
              {rows.map((o, i) => (
                <li key={o.value + ':' + i} role="presentation">
                  <button
                    type="button" role="option" aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)} onClick={() => onPick(o.value)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink',
                      i === active && 'bg-goms-sky/[0.16]', o.value === '' && 'text-muted',
                    )}
                  >
                    {o.isPerson && <Avatar person={{ name: o.label, photoUrl: o.photoUrl }} size="xs" />}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.value === value && o.value !== '' && <Icon name="Check" size={13} className="shrink-0 text-goms-navy" />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </PopoverPanel>
    </div>
  )
}

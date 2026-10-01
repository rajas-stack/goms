import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { coerceCustomValue, parseMultiValue } from '@goms/domain'
import { Checkbox } from '@/components/ui/Checkbox'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { cn } from '@/lib/utils'
import { NO_LOOKUPS, isEmptyCell, optionsOf, type EntityLookups, type GridColumnMeta } from '../gridColumns'

export type CellDraft = string | number | boolean | null

/** Open editors holding a change that is not saved yet, keyed by cell. The grid
 *  reads this when asked to lock: a pending edit must be saved or discarded first. */
export type PendingEdits = MutableRefObject<Map<string, { discard: () => void }>>

// The editor sits exactly on top of the cell, like a spreadsheet's in-cell editor:
// it covers the cell border with a 2px accent outline and never changes row height.
const input = 'absolute inset-0 z-20 h-[31px] w-full rounded-none border-2 bg-white px-2 text-[12.5px] text-ink shadow-[0_2px_8px_rgba(11,43,73,0.22)] outline-none'

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

  const start = () => {
    cancelled.current = false
    done.current = false
    setDraft(current)
    setError(null)
    setEditing(true)
  }

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
          'flex h-[31px] w-full min-w-0 cursor-cell items-center gap-1 px-2 outline-none',
          'hover:shadow-[inset_0_0_0_1px_rgba(76,167,221,0.9)] focus-visible:shadow-[inset_0_0_0_2px_#0B2B49]',
          externalError && 'text-crimson shadow-[inset_0_0_0_1px_#B23A48]',
        )}
        onClick={(e) => { e.stopPropagation(); start() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); e.stopPropagation(); start() } }}
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
  } else if (type === 'select' || type === 'boolean' || type === 'state' || type === 'person' || type === 'department') {
    const choices = type === 'boolean'
      ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
      : options
    editor = (
      <select
        aria-label={col.header} className={cn(input, borderClass)} value={draft}
        ref={(el) => { inputRef.current = el }}
        onChange={(e) => { setDraft(e.target.value); commit(e.target.value) }}
        onKeyDown={onKeyDown}
        onBlur={cancel}
      >
        <option value="">—</option>
        {removedOption && <option value={current}>{current} (removed option)</option>}
        {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
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
    <div className="relative h-[31px] w-full" onClick={(e) => e.stopPropagation()}>
      {editor}
      {error && (
        <p role="alert" className="absolute left-0 top-full z-30 mt-0.5 whitespace-nowrap rounded bg-crimson px-1.5 py-0.5 text-[11px] text-white shadow-pop">{error}</p>
      )}
    </div>
  )
}

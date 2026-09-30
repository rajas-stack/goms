import { useEffect, useRef, useState, type ReactNode } from 'react'
import { coerceCustomValue } from '@goms/domain'
import { cn } from '@/lib/utils'
import { isEmptyCell, type GridColumnMeta } from '../gridColumns'

export type CellDraft = string | number | boolean | null

const input = 'h-7 w-full min-w-[7rem] rounded-md border bg-white px-1.5 text-[13px] text-ink focus-visible:focus-ring'

/** One inline-editable grid cell (Excel-style): click / Enter / F2 to edit,
 *  Enter or blur to commit, Esc to cancel. Only ever rendered for columns the
 *  registry marks `editable` — protected / corrigendum-tracked fields never
 *  get one. Validation for a custom column uses the same `coerceCustomValue`
 *  the API applies, so a value rejected here is a value the API would reject;
 *  an invalid draft keeps the editor open with the message inline. `externalError`
 *  is a server-side rejection that rolled the cell back after commit. */
export function EditableCell({ col, value, display, externalError, onCommit }: {
  col: GridColumnMeta
  value: unknown
  display: ReactNode
  externalError?: string
  onCommit: (value: CellDraft) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)
  const cancelled = useRef(false)
  // Enter unmounts the input, which some browsers report as a blur — without
  // this guard that would commit the same edit twice.
  const done = useRef(false)

  const type = col.type ?? 'text'
  const current = isEmptyCell(value) ? '' : String(value)
  // A stored select value that is no longer one of the field's options stays
  // visible (and selectable as-is) but is tagged, so a removed option never
  // silently disappears from a cell.
  const removedOption = type === 'select' && current !== '' && !col.options?.some((o) => o.value === current)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

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
      // Custom columns validate against their own definition; the standard
      // opportunity attributes (city, sector) are plain trimmed text.
      next = col.custom
        ? coerceCustomValue(col.custom.dataType, raw, col.custom.options)
        : (raw.trim() === '' ? null : raw.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid value.')
      return
    }
    done.current = true
    setEditing(false)
    setError(null)
    // No-op edits are not writes (and not audit entries).
    if ((next === null ? '' : String(next)) === current) return
    onCommit(next)
  }

  const cancel = () => {
    cancelled.current = true
    setEditing(false)
    setError(null)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
    else if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  if (!editing) {
    return (
      <div
        role="button" tabIndex={0} aria-label={`Edit ${col.header}`}
        title={externalError}
        className={cn(
          'min-h-[1.5rem] cursor-text rounded px-1 py-0.5 hover:bg-ink-900/[0.05] focus-visible:focus-ring',
          externalError && 'text-crimson ring-1 ring-crimson/60',
        )}
        onClick={(e) => { e.stopPropagation(); start() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); e.stopPropagation(); start() } }}
      >
        {display}
        {externalError && <span className="ml-2 text-[11px]">{externalError}</span>}
      </div>
    )
  }

  const borderClass = error ? 'border-crimson' : 'border-line'
  let editor: ReactNode
  if (type === 'select' || type === 'boolean') {
    const options = type === 'boolean'
      ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
      : (col.options ?? [])
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
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  } else {
    editor = (
      <input
        aria-label={col.header} className={cn(input, borderClass)} value={draft}
        type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'} step={type === 'number' ? 'any' : undefined}
        ref={(el) => { inputRef.current = el }}
        onChange={(e) => { setDraft(e.target.value); if (error) setError(null) }}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
    )
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {editor}
      {error && <p role="alert" className="mt-0.5 text-[11px] text-crimson">{error}</p>}
    </div>
  )
}

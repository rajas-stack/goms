import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { coerceCustomValue, parseMultiValue } from '@goms/domain'
import { Checkbox } from '@/components/ui/Checkbox'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { Icon } from '@/components/ui/Icon'
import { FriendlyDateInput } from '@/components/ui/FriendlyDateInput'
import { cn } from '@/lib/utils'
import { toFriendlyValue } from '@/lib/friendlyDate'
import { Avatar } from '@/components/ui/Avatar'
import type { BidGridRow } from '@/lib/types'
import { useMasterMutations, useMasters } from '@/modules/commercial-calculator/api'
import { codeFromName } from '@/modules/commercial-calculator/components/MasterFormDialog'
import { useAddBidStage } from '@/features/masters/useBidStages'
import type { MasterEntityKey } from '@/modules/commercial-calculator/types'
import { formatCellDate, parseCellDate } from '../dateInput'
import { NO_LOOKUPS, isEmptyCell, type ColumnOption, type EntityLookups, type GridColumnMeta } from '../gridColumns'
import { isMultiPersonColumn, scopedOptionsOf } from '../peopleColumns'
import { isMultiline } from './CellBullets'
import { citiesOf } from './cityOptions'

export type CellDraft = string | number | boolean | null

/** Open editors holding a change that is not saved yet, keyed by cell. The grid
 *  reads this when asked to lock: a pending edit must be saved or discarded first. */
export type PendingEdits = MutableRefObject<Map<string, { discard: () => void }>>

const input = 'absolute inset-0 z-20 h-full min-h-[35px] w-full rounded-none border-2 bg-white px-2 text-[12.5px] text-ink shadow-[0_2px_8px_rgba(11,43,73,0.22)] outline-none'

/** Raw text for a type's editor, from the stored value. */
function draftOf(type: string, value: unknown, dateTime = false): string {
  if (isEmptyCell(value)) return ''
  if (type === 'multiselect') return JSON.stringify(parseMultiValue(value))
  if (type === 'date') {
    const text = String(value)
    if (dateTime && /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
      const instant = new Date(text)
      if (!Number.isNaN(instant.getTime())) return toFriendlyValue(instant, 'datetime-local')
    }
    return text.slice(0, dateTime ? 16 : 10)
  }
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
export function EditableCell({ col, value, display, externalError, onCommit, lookups = NO_LOOKUPS, pending, cellKey, row }: {
  col: GridColumnMeta
  value: unknown
  display: ReactNode
  externalError?: string
  onCommit: (value: CellDraft) => void
  lookups?: EntityLookups
  pending?: PendingEdits
  cellKey?: string
  /** The row being edited, for a pick-list that depends on another of its cells (City on State). */
  row?: Pick<BidGridRow, 'stateCode'>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null)
  const [editorHeight, setEditorHeight] = useState(35)
  const cancelled = useRef(false)
  const displayRef = useRef<HTMLDivElement>(null)
  // Values this editor just added to a master: valid picks before the column's options refetch.
  const created = useRef<string[]>([])
  // After Enter / Escape / blur-commit the editor unmounts; focus goes back to
  // the cell so the keyboard user keeps their place (F2 / Enter edits again).
  const refocus = useRef(false)
  // Enter unmounts the input, which some browsers report as a blur — without
  // this guard that would commit the same edit twice.
  const done = useRef(false)

  // A custom person column set to "Multiple" (Manage columns › People columns) picks like a multi-select.
  const type = isMultiPersonColumn(col, lookups) ? 'multiselect' : col.type ?? 'text'
  // Every user-entered date can retain an optional clock time.
  const withTime = type === 'date'
  const current = draftOf(type, value, withTime)
  // City picks from the row's State's districts (or a typed name); there is nothing to pick before a State.
  const isCity = col.id === 'city'
  const options = isCity ? citiesOf(row?.stateCode, current) : scopedOptionsOf(col, lookups, row?.stateCode, value)
  const multiline = isMultiline(col)
  // A stored select value that is no longer one of the field's options stays
  // visible (and selectable as-is) but is tagged, so a removed option never
  // silently disappears from a cell.
  const removedOption = type === 'select' && current !== '' && !options.some((o) => o.value === current)
  const dirty = editing && draft !== current

  useEffect(() => {
    if (editing) inputRef.current?.focus()
    else if (refocus.current) { refocus.current = false; displayRef.current?.focus() }
  }, [editing])

  useEffect(() => {
    const element = inputRef.current
    if (!editing || !(element instanceof HTMLTextAreaElement)) return
    element.style.height = 'auto'
    element.style.height = Math.max(editorHeight, element.scrollHeight) + 'px'
  }, [editing, draft, editorHeight])

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
    setEditorHeight(Math.max(35, displayRef.current?.getBoundingClientRect().height ?? 35))
    setError(null)
    setEditing(true)
  }
  // Spreadsheet habit: typing on a selected cell replaces its value (free-text editors only).
  const typesFreely = !(col.pick || isCity || ['select', 'boolean', 'state', 'person', 'department', 'multiselect'].includes(type))

  const commit = (raw: string) => {
    if (cancelled.current || done.current) return
    let next: CellDraft
    try {
      if (type === 'date' && raw.trim() !== '') {
        const iso = parseCellDate(raw, withTime)
        if (!iso) throw new Error(`Could not read that date. Try 21.09.2026${withTime ? ' 14:30' : ''} or 21 Sep 2026.`)
        raw = iso
      }
      if (type === 'multiselect' && parseMultiValue(raw).length === 0) raw = ''
      if (col.custom) next = coerceCustomValue(col.custom.dataType, raw, [...(col.custom.options ?? []), ...created.current])
      else if (raw.trim() === '') {
        if (col.required) throw new Error(`${col.header} is required.`)
        next = null
      } else next = raw.trim()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid value.')
      return
    }
    done.current = true
    refocus.current = document.activeElement === inputRef.current
    setEditing(false)
    setError(null)
    // No-op edits are not writes (and not audit entries).
    // (A multi-pick compares as a list: a one-person "Multiple" cell saves as a plain id.)
    if ((type === 'multiselect' ? draftOf(type, next) : next === null ? '' : String(next)) === current) return
    // Outside a custom field (a General multi-select is plain text) the choices are stored one per line.
    onCommit(type === 'multiselect' && !col.custom && typeof next === 'string' ? parseMultiValue(next).join('\n') : next)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A bulleted (multi-line) cell takes Enter as a new point and saves on Ctrl/⌘+Enter; other text cells use Shift+Enter.
    const newLine = e.target instanceof HTMLTextAreaElement && (multiline ? !(e.ctrlKey || e.metaKey) : e.shiftKey)
    if (e.key === 'Enter' && !newLine) { e.preventDefault(); commit(draft) }
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
          'flex min-h-[35px] w-full min-w-0 cursor-cell items-center gap-1 px-3 py-1.5 whitespace-pre-wrap [overflow-wrap:anywhere] outline-none',
          'shadow-[inset_0_0_0_1px_rgba(76,167,221,0.35)] hover:shadow-[inset_0_0_0_1px_rgba(76,167,221,0.95)]',
          'focus:shadow-[inset_0_0_0_2px_rgb(var(--c-goms-navy))] focus:bg-grid-hover',
          externalError && 'text-crimson shadow-[inset_0_0_0_1px_rgb(var(--c-crimson))]',
        )}
        onClick={(e) => { e.stopPropagation(); start() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); e.stopPropagation(); start() }
          else if (typesFreely && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); start(e.key) }
          else if ((e.key === 'Delete' || e.key === 'Backspace') && !col.required && typesFreely) { e.preventDefault(); e.stopPropagation(); start(''); }
        }}
      >
        <span className="min-w-0 flex-1">{display}</span>
        {externalError && <span className="shrink-0 text-[11px]">{externalError}</span>}
      </div>
    )
  }

  const borderClass = error ? 'border-crimson' : 'border-goms-navy'
  let editor: ReactNode
  if (isCity || col.pick || ['select', 'multiselect', 'boolean', 'state', 'person', 'department'].includes(type)) {
    const multiple = type === 'multiselect'
    // Ticking keeps the master's (options') order; values not among the options yet go last.
    const toggle = (v: string) => {
      const chosen = parseMultiValue(draft)
      const next = chosen.includes(v) ? chosen.filter((c) => c !== v) : [...chosen, v]
      setDraft(JSON.stringify([...options.map((o) => o.value).filter((o) => next.includes(o)), ...next.filter((c) => !options.some((o) => o.value === c))]))
      if (error) setError(null)
    }
    const picker: CellPickerProps = {
      label: col.header, options: type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : options,
      value: draft, borderClass, allowClear: !col.required, removed: removedOption ? current : null, multiple,
      onPick: multiple ? toggle : (v) => { setDraft(v); commit(v) }, onDone: () => commit(draft), onCancel: cancel,
      onCreate: isCity ? (text) => text : undefined,
      emptyNote: isCity && row?.stateCode == null ? 'Choose the State first — City lists that State’s cities.' : undefined,
    }
    editor = col.createMaster
      ? <MasterPicker master={col.createMaster} onCreated={(name) => { created.current = [...created.current, name] }} {...picker} />
      : col.id === 'stageKey' ? <StagePicker {...picker} /> : <CellPicker {...picker} />
  } else if (['text', 'url', 'email', 'phone'].includes(type)) {
    editor = (
      <textarea
        aria-label={col.header} className={cn(input, borderClass, 'relative block resize-none overflow-hidden py-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]')}
        rows={1} value={draft} ref={el => { inputRef.current = el }}
        placeholder={multiline ? 'One point per line · Ctrl+Enter saves' : undefined}
        onChange={e => { setDraft(e.target.value); if (error) setError(null) }}
        onKeyDown={onKeyDown} onBlur={() => commit(draft)}
      />
    )
  } else if (type === 'date') {
    editor = <FriendlyDateInput aria-label={col.header} autoFocus textInputRef={element => { inputRef.current = element }}
      calendarLabel={`Pick ${col.header} from a calendar`}
      format="optional-time" value={draft}
      onChange={(next, change) => { setDraft(change.invalid ? change.text : next); setError(null) }}
      wrapperClassName="relative z-30 min-w-[210px] rounded border-2 border-goms-sky bg-white p-1 shadow-pop"
      className="h-8 text-[12.5px]" />
  } else {
    const numeric = type === 'number' || type === 'currency'
    editor = (
      <>
        <input
          aria-label={col.header} className={cn(input, borderClass)} value={draft}
          type={numeric ? 'number' : 'text'} step={numeric ? 'any' : undefined}
          inputMode={type === 'email' ? 'email' : type === 'phone' ? 'tel' : type === 'url' ? 'url' : undefined}
          ref={(el) => { inputRef.current = el }}
          onChange={(e) => { setDraft(e.target.value); if (error) setError(null) }}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
        />
      </>
    )
  }

  return (
    <div className="relative w-full" style={{ minHeight: editorHeight }} onClick={(e) => e.stopPropagation()}
      onBlur={event => { if (type === 'date' && !event.currentTarget.contains(event.relatedTarget as Node | null)) commit(draft) }}
      onKeyDown={event => { if (type === 'date' && (event.key === 'Escape' || !(event.target instanceof HTMLButtonElement))) onKeyDown(event) }}>
      {editor}
      {error && (
        <p role="alert" className="absolute left-0 top-full z-30 mt-0.5 whitespace-nowrap rounded bg-crimson px-1.5 py-0.5 text-[11px] text-white shadow-pop">{error}</p>
      )}
    </div>
  )
}

interface CellPickerProps {
  label: string
  options: ColumnOption[]
  /** The chosen value; for `multiple`, the JSON list of chosen values. */
  value: string
  borderClass: string
  allowClear: boolean
  /** A stored value that is no longer one of the options (shown, tagged, pickable as-is). */
  removed: string | null
  /** Tick several values: a pick toggles one and the list stays open until Done (clicking away also saves). */
  multiple?: boolean
  onPick: (value: string) => void
  onDone: () => void
  onCancel: () => void
  /** Offered as `+ Add "<text>"` when the search text is not an option yet; gives the value to pick. */
  onCreate?: (text: string) => string | Promise<string>
  /** Shown in place of the options while there is nothing to pick. */
  emptyNote?: string
}

/** A Notion-style pick-list for a cell: click the cell, search, click an option (or tick
 *  several for a multi-select). The list is the live GOMS records (sales people,
 *  departments, states) or the column's own options. Escape cancels; clicking away
 *  cancels a single pick and saves a multi-select. */
function CellPicker({ label, options, value, borderClass, allowClear, removed, multiple = false, onPick, onDone, onCancel, onCreate, emptyNote }: CellPickerProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const chosen = multiple ? parseMultiValue(value) : []
  const q = query.trim()
  const matches = (o: ColumnOption) => o.label.toLowerCase().includes(q.toLowerCase())
  // Chosen values that are not options (yet) stay listed, ticked, so they can be unticked.
  const extras = chosen.filter((c) => !options.some((o) => o.value === c)).map((c) => ({ value: c, label: c }))
  const canAdd = !!onCreate && !emptyNote && q !== '' && ![...options, ...extras].some((o) => o.label.toLowerCase() === q.toLowerCase())
  const rows: (ColumnOption & { add?: boolean })[] = [
    // Clearing only makes sense once something is chosen — and not while searching, where Enter must pick the match.
    ...(allowClear && value && !multiple && !q ? [{ value: '', label: '— Clear' }] : []),
    ...(removed ? [{ value: removed, label: removed + ' (removed option)' }].filter(matches) : []),
    ...(emptyNote ? [] : [...extras, ...options].filter(matches)),
    ...(canAdd ? [{ value: q, label: `+ Add "${q}"`, add: true }] : []),
  ]
  const shownOption = multiple ? undefined : options.find((o) => o.value === value)
  const shown = multiple
    ? chosen.map((c) => options.find((o) => o.value === c)?.label ?? c).join(', ')
    : shownOption?.label ?? (removed && value === removed ? removed : '')
  const pick = async (row: (typeof rows)[number]) => {
    if (!row.add) { onPick(row.value); return }
    if (!onCreate || adding) return
    setAdding(true)
    setAddError(null)
    try {
      const added = await onCreate(row.value)
      setQuery('')
      setActive(0)
      onPick(added)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not add it.')
    } finally {
      setAdding(false)
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && multiple && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onDone() }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) void pick(rows[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }
  return (
    <div ref={anchorRef} className={cn(input, borderClass, 'flex items-center gap-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]')}>
      {shownOption?.isPerson && <Avatar person={{ name: shownOption.label, photoUrl: shownOption.photoUrl }} size="xs" />}
      <span className="min-w-0 flex-1">{shown || <span className="text-muted">Choose…</span>}</span>
      <Icon name="ChevronDown" size={13} className="shrink-0 text-muted" />
      <PopoverPanel open anchorRef={anchorRef} onClose={multiple ? onDone : onCancel} maxPanelHeight={300}>
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
            <ul role="listbox" aria-label={multiple ? `${label} options` : label} aria-multiselectable={multiple || undefined} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-1">
              {emptyNote && <li className="px-2 py-1.5 text-[13px] text-muted">{emptyNote}</li>}
              {rows.length === 0 && !emptyNote && <li className="px-2 py-1.5 text-[13px] text-muted">No match</li>}
              {rows.map((o, i) => (
                <li key={o.value + ':' + i} role="presentation">
                  {multiple && !o.add ? (
                    <label
                      title={o.hint} onMouseEnter={() => setActive(i)}
                      className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink', i === active && 'bg-goms-sky/[0.16]')}
                    >
                      <Checkbox aria-label={o.label} checked={chosen.includes(o.value)} onChange={() => onPick(o.value)} />
                      <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{o.label}</span>
                    </label>
                  ) : (
                    <button
                      type="button" role="option" aria-selected={!o.add && o.value === value} title={o.hint} disabled={o.add && adding}
                      onMouseEnter={() => setActive(i)} onClick={() => void pick(o)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink',
                        i === active && 'bg-goms-sky/[0.16]', o.value === '' && 'text-muted', o.add && 'font-medium text-goms-navy',
                      )}
                    >
                      {o.isPerson && <Avatar person={{ name: o.label, photoUrl: o.photoUrl }} size="xs" />}
                      <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{o.add && adding ? 'Adding…' : o.label}</span>
                      {!o.add && o.value === value && o.value !== '' && <Icon name="Check" size={13} className="shrink-0 text-goms-navy" />}
                    </button>
                  )}
                </li>
              ))}
              {multiple && (
                <li role="presentation" className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-paper px-1 pt-1">
                  <button type="button" className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-goms-sky/[0.14]" onClick={onCancel}>Cancel</button>
                  <button type="button" className="rounded-md bg-goms-navy px-2 py-1 text-[12px] text-paper" onClick={onDone}>Done</button>
                </li>
              )}
            </ul>
            {addError && <p role="alert" className="border-t border-line px-2 py-1.5 text-[12px] text-crimson">{addError}</p>}
          </motion.div>
        )}
      </PopoverPanel>
    </div>
  )
}

/** A CellPicker whose typed text can be added to the column's master (Settings > Masters) and picked at
 *  once. The code is generated from the name, as the master's own form does. */
function MasterPicker({ master, onCreated, ...picker }: CellPickerProps & { master: MasterEntityKey; onCreated: (name: string) => void }) {
  const { data: rows = [] } = useMasters(master)
  const { create } = useMasterMutations(master)
  const add = async (name: string) => {
    const row = await create.mutateAsync({ code: codeFromName(name, rows.map((r) => r.code)), name, description: '' })
    onCreated(row.name)
    return row.name
  }
  return <CellPicker {...picker} onCreate={add} />
}

/** The Bid Stage picker: a typed name that isn't a stage yet is added to Settings > Masters > Bid Stages and picked. */
function StagePicker(picker: CellPickerProps) {
  const { add } = useAddBidStage()
  return <CellPicker {...picker} onCreate={add} />
}

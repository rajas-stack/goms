import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { GridCellValue, GridColumn, GridSelectOption } from '@goms/domain'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { cellText, parseCellText } from './gridModel'

export type CommitMove = 'down' | 'right' | 'left' | 'none'

const NUMBER_FORMAT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 })
const CURRENCY_FORMAT = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

export function OptionPill({ option }: { option: GridSelectOption }) {
  return <Badge tone={option.color} className="max-w-full truncate">{option.value || ' '}</Badge>
}

export function CellDisplay({ column, value }: { column: GridColumn; value: GridCellValue | undefined }) {
  if (column.type === 'checkbox') {
    return (
      <span aria-label={value ? 'Checked' : 'Unchecked'} className={cn('flex h-4 w-4 items-center justify-center rounded border',
        value ? 'border-goms-navy bg-goms-navy text-white' : 'border-line bg-white')}>
        {value === true && <Icon name="Check" size={12} />}
      </span>
    )
  }
  if (value === null || value === undefined || value === '') return null
  switch (column.type) {
    case 'number': return <span className="block text-right tabular-nums">{NUMBER_FORMAT.format(value as number)}</span>
    case 'currency': return <span className="block text-right tabular-nums">{CURRENCY_FORMAT.format(value as number)}</span>
    case 'percent': return <span className="block text-right tabular-nums">{NUMBER_FORMAT.format(value as number)}%</span>
    case 'date': return <span className="tabular-nums">{new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
    case 'url':
      // Defence in depth: validateSynopsisGrid already allows only these schemes.
      if (!/^(https?:|mailto:)/i.test(String(value).trim())) return <span className="truncate">{String(value)}</span>
      return <a href={String(value)} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="truncate text-goms-navy underline decoration-goms-sky underline-offset-2">{String(value)}</a>
    case 'singleSelect': {
      const option = column.options?.find(o => o.id === value)
      return option ? <OptionPill option={option} /> : null
    }
    case 'multiSelect': {
      const options = (value as string[]).map(id => column.options?.find(o => o.id === id)).filter((o): o is GridSelectOption => !!o)
      return <span className="flex gap-1 overflow-hidden">{options.map(o => <OptionPill key={o.id} option={o} />)}</span>
    }
    case 'longText': return <span className="line-clamp-2 whitespace-pre-wrap">{String(value)}</span>
    default: return <span className="truncate">{String(value)}</span>
  }
}

interface EditorProps {
  column: GridColumn
  value: GridCellValue | undefined
  /** Text the user typed to start editing (replaces the value), if any. */
  seed: string | null
  onCommit: (value: GridCellValue, move: CommitMove) => void
  onCancel: () => void
  onCreateOption: (text: string) => string | null
}

const INVALID_HINT: Partial<Record<GridColumn['type'], string>> = {
  number: 'Enter a number', currency: 'Enter an amount, e.g. 300000', percent: 'Enter a percentage, e.g. 30',
  date: 'Enter a date, e.g. 05/11/2026', url: 'Enter a web address starting with https://',
}

const inputClass = 'h-full w-full bg-white px-2 text-[13px] text-ink outline-none'

/** Shared key handling: Enter ↓, Tab →, Shift+Tab ←, Escape cancels. */
function commitKeys(event: KeyboardEvent, commit: (move: CommitMove) => void, cancel: () => void, multiline = false) {
  if (event.key === 'Escape') { event.preventDefault(); cancel() }
  else if (event.key === 'Tab') { event.preventDefault(); commit(event.shiftKey ? 'left' : 'right') }
  else if (event.key === 'Enter' && !(multiline && event.shiftKey)) { event.preventDefault(); commit('down') }
}

export function CellEditor(props: EditorProps) {
  // Commit or cancel exactly once: unmounting the editor blurs it, and that
  // late blur must not commit a second (stale) value over the first.
  const done = useRef(false)
  const once = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => { if (done.current) return; done.current = true; fn(...args) }
  const guarded = { ...props, onCommit: once(props.onCommit), onCancel: once(props.onCancel) }
  if (props.column.type === 'singleSelect' || props.column.type === 'multiSelect') return <SelectEditor {...guarded} />
  return <TextEditor {...guarded} />
}

function TextEditor({ column, value, seed, onCommit, onCancel }: EditorProps) {
  const initial = seed ?? (column.type === 'date' ? String(value ?? '') : cellText(column, value))
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    if (seed === null && column.type !== 'date') el.select()
  }, [column.type, seed])
  const [invalid, setInvalid] = useState(false)
  const commit = (move: CommitMove) => {
    const parsed = parseCellText(column, text)
    // Never wipe a value because the new text did not parse (e.g. "12 lakh" in a number).
    if (parsed === null && text.trim()) {
      if (move === 'none') { onCancel(); return }
      setInvalid(true); return
    }
    onCommit(parsed, move)
  }
  if (column.type === 'longText') {
    return (
      <textarea ref={ref} aria-label={column.name} value={text} rows={4}
        onChange={event => setText(event.target.value)} onBlur={() => commit('none')}
        onKeyDown={event => commitKeys(event, commit, onCancel, true)}
        className="absolute left-0 top-0 z-30 min-h-[96px] w-full min-w-[260px] resize rounded-sm border-2 border-goms-navy bg-white p-2 text-[13px] text-ink shadow-pop outline-none" />
    )
  }
  const type = column.type === 'date' ? 'date' : column.type === 'url' ? 'url' : 'text'
  return (
    <input ref={ref} aria-label={column.name} type={type} value={text}
      inputMode={['number', 'currency', 'percent'].includes(column.type) ? 'decimal' : undefined}
      aria-invalid={invalid || undefined} title={invalid ? INVALID_HINT[column.type] : undefined}
      onChange={event => { setText(event.target.value); setInvalid(false) }} onBlur={() => commit('none')}
      onKeyDown={event => commitKeys(event, commit, onCancel)} className={cn(inputClass, invalid && 'bg-crimson-100')} />
  )
}

function SelectEditor({ column, value, seed, onCommit, onCancel, onCreateOption }: EditorProps) {
  const multi = column.type === 'multiSelect'
  const [query, setQuery] = useState(seed ?? '')
  const [picked, setPicked] = useState<string[]>(() => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []))
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const options = (column.options ?? []).filter(o => o.value.toLowerCase().includes(query.trim().toLowerCase()))
  const canCreate = !!query.trim() && !column.options?.some(o => o.value.toLowerCase() === query.trim().toLowerCase())
  const entries: ({ kind: 'option'; option: GridSelectOption } | { kind: 'create' })[] = [
    ...options.map(option => ({ kind: 'option' as const, option })), ...(canCreate ? [{ kind: 'create' as const }] : []),
  ]
  const finish = (ids: string[], move: CommitMove) => onCommit(multi ? (ids.length ? ids : null) : (ids[0] ?? null), move)
  const choose = (id: string) => {
    if (!multi) { finish([id], 'down'); return }
    setPicked(current => (current.includes(id) ? current.filter(x => x !== id) : [...current, id]))
    setQuery('')
  }
  const pick = (index: number) => {
    const entry = entries[index]
    if (!entry) return
    if (entry.kind === 'option') { choose(entry.option.id); return }
    const id = onCreateOption(query.trim())
    if (id) choose(id)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(entries.length - 1, i + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (event.key === 'Enter' && entries.length && (query.trim() || !multi)) { event.preventDefault(); pick(active) }
    else commitKeys(event, move => finish(picked, move), onCancel)
  }
  return (
    <div className="absolute left-0 top-0 z-30 w-full min-w-[220px] rounded-md border border-line bg-paper shadow-pop"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) finish(picked, 'none') }}>
      {multi && picked.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-line p-1.5">
          {picked.map(id => { const o = column.options?.find(x => x.id === id); return o && (
            <button key={id} type="button" onClick={() => choose(id)} aria-label={`Remove ${o.value}`} className="inline-flex items-center gap-0.5">
              <OptionPill option={o} /><Icon name="X" size={11} className="text-muted" />
            </button>
          ) })}
        </div>
      )}
      <input ref={ref} aria-label={`${column.name} option search`} value={query} placeholder="Search or create option"
        onChange={event => { setQuery(event.target.value); setActive(0) }} onKeyDown={onKeyDown}
        className="h-8 w-full border-b border-line bg-white px-2 text-[13px] outline-none" />
      <ul role="listbox" aria-multiselectable={multi} className="max-h-56 overflow-y-auto p-1">
        {!multi && <li><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => finish([], 'down')} className="w-full rounded px-2 py-1 text-left text-[12px] text-muted hover:bg-grid-hover">Clear</button></li>}
        {entries.map((entry, index) => (
          <li key={entry.kind === 'option' ? entry.option.id : 'create'} role="option" aria-selected={entry.kind === 'option' && picked.includes(entry.option.id)}>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => pick(index)}
              className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px]', index === active ? 'bg-grid-selected' : 'hover:bg-grid-hover')}>
              {entry.kind === 'option'
                ? <><OptionPill option={entry.option} />{picked.includes(entry.option.id) && <Icon name="Check" size={12} className="ml-auto text-goms-navy" />}</>
                : <><Icon name="Plus" size={12} /> Create “{query.trim()}”</>}
            </button>
          </li>
        ))}
        {!entries.length && <li className="px-2 py-1 text-[12px] text-muted">No options. Type to create one.</li>}
      </ul>
    </div>
  )
}

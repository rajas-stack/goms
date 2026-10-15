import { useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { addTags, type TagLimits } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { tagTone } from './model'
import { cn } from '@/lib/utils'

interface Props {
  id: string
  /** Accessible name of the chip list, e.g. "Offerings". */
  label: string
  limits: TagLimits
  value: readonly string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
  /** Reports a rejected tag (too long, too many) or clears it with null. */
  onError: (message: string | null) => void
}

/** Chip input: type and press Enter or comma to add, × or Backspace on an empty box to remove. */
export function TagInput({ id, label, limits, value, onChange, placeholder, disabled, onError }: Props) {
  const [draft, setDraft] = useState('')
  const full = value.length >= limits.max

  const commit = (parts: readonly string[]): boolean => {
    try {
      onChange(addTags(value, parts, limits))
      onError(null)
      return true
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : `Could not add that ${limits.label}.`)
      return false
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (draft.trim() && commit([draft])) setDraft('')
    } else if (event.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (!/[,\n]/.test(text)) return
    event.preventDefault()
    if (commit(text.split(/[,\n]/))) setDraft('')
  }

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5 transition-colors focus-within:border-ink-600">
      <ul className="contents" aria-label={label}>
        {value.map(tag => (
          <li key={tag} className={cn('inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pl-2 pr-1 text-[12px] font-medium', tagTone(tag))}>
            <span className="truncate">{tag}</span>
            <button type="button" disabled={disabled} aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter(item => item !== tag))}
              className="flex h-4 w-4 items-center justify-center rounded-full opacity-70 hover:bg-ink-900/10 hover:opacity-100 focus-visible:focus-ring">
              <Icon name="X" size={11} />
            </button>
          </li>
        ))}
      </ul>
      <input id={id} value={draft} disabled={disabled || full} aria-describedby={`${id}-hint`}
        placeholder={full ? `Limit of ${limits.max} reached` : value.length ? 'Add another…' : placeholder}
        className="h-7 min-w-[9rem] flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-muted/70"
        onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste}
        onBlur={() => { if (draft.trim() && commit([draft])) setDraft('') }} />
      <span id={`${id}-hint`} className="sr-only">Press Enter or comma to add. {value.length} of {limits.max}.</span>
    </div>
  )
}

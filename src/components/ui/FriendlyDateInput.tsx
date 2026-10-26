import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type Ref } from 'react'
import { Input } from './Field'
import { Icon } from './Icon'
import { cn } from '@/lib/utils'
import {
  formatFriendlyPreview, formatFriendlyValue, friendlyValueToDate, parseFriendlyDate,
  toFriendlyValue, parseFriendlyValue, type FriendlyDateFormat,
} from '@/lib/friendlyDate'

export interface FriendlyDateChange {
  /** What the user typed. */
  text: string
  /** True when there is text but it is not a recognisable date (the emitted value is then ''). */
  invalid: boolean
}

export interface FriendlyDateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'defaultValue'> {
  /** The stored value, in the same shape the native input used: `yyyy-mm-dd` (date),
   *  `yyyy-mm-ddTHH:mm` (datetime-local) or a full ISO instant (iso). '' is empty. */
  value: string
  onChange: (value: string, change: FriendlyDateChange) => void
  format?: FriendlyDateFormat
  /** Earliest / latest allowed value, in `format`. Like the native attributes they limit the
   *  calendar and flag the field, but never rewrite what the user entered. */
  min?: string
  max?: string
  /** Show the small calendar button that opens the browser's own picker. */
  showPicker?: boolean
  /** Float the preview / error under the field instead of pushing content down (toolbars). */
  floatingFeedback?: boolean
  /** Message shown when the text is not a date. */
  invalidMessage?: string
  /** Classes for the outer wrapper (width / layout); `className` styles the text box. */
  wrapperClassName?: string
  textInputRef?: Ref<HTMLInputElement>
  calendarLabel?: string
}

const PLACEHOLDER: Record<FriendlyDateFormat, string> = {
  date: 'e.g. 13 May 2026 or 13/5/26',
  'optional-time': 'e.g. 13 May 2026, optionally 15:00',
  'datetime-local': 'e.g. 13th May 2026 3pm or 13/5/26 15:00',
  iso: 'e.g. 13th May 2026 3pm or 13/5/26 15:00',
}

const INVALID: Record<FriendlyDateFormat, string> = {
  date: 'Enter a valid date, or clear the field.',
  'optional-time': 'Enter a valid date and optional time, or clear the field.',
  'datetime-local': 'Enter a valid date and time, or clear the field.',
  iso: 'Enter a valid date and time, or clear the field.',
}

/** Compare two stored values of the same format (null when either is missing/unreadable). */
function compareValues(a: string, b: string, format: FriendlyDateFormat): number | null {
  const left = friendlyValueToDate(a, format)
  const right = friendlyValueToDate(b, format)
  if (!left || !right) return null
  return left.getTime() - right.getTime()
}

function rangeMessage(value: string, format: FriendlyDateFormat, min?: string, max?: string): string | null {
  if (!value) return null
  if (min && (compareValues(value, min, format) ?? 0) < 0) return `Must be on or after ${formatFriendlyValue(min, format)}.`
  if (max && (compareValues(value, max, format) ?? 0) > 0) return `Must be on or before ${formatFriendlyValue(max, format)}.`
  return null
}

/** The native picker's value for a stored value (the picker is `date` or `datetime-local`). */
function pickerValue(value: string, format: FriendlyDateFormat): string {
  if (format !== 'iso') return value
  const parsed = friendlyValueToDate(value, format)
  return parsed ? toFriendlyValue(parsed, 'datetime-local') : ''
}

/** A date field that accepts any common typed or pasted format ("13th May 2026 3pm",
 *  "13/5/26", "24thsept261500", "2026-05-13"…), shows what it captured, and stores the
 *  same value the native date input did. */
export function FriendlyDateInput({
  value, onChange, format = 'optional-time', min, max, showPicker = true, floatingFeedback = false,
  invalidMessage, wrapperClassName, className, placeholder, disabled, readOnly, textInputRef, calendarLabel,
  'aria-describedby': describedBy, ...inputProps
}: FriendlyDateInputProps) {
  const feedbackId = useId()
  const pickerRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(() => formatFriendlyValue(value, format))
  const [isTyped, setIsTyped] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const optionalTime = format === 'optional-time'
  // The value this field last reported; any other incoming value came from outside (reset, load).
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    setText(formatFriendlyValue(value, format))
    setIsTyped(false)
  }, [value, format])

  const emit = (nextText: string, nextValue: string) => {
    lastEmitted.current = nextValue
    onChange(nextValue, { text: nextText, invalid: !!nextText.trim() && !nextValue })
  }

  const handleText = (nextText: string) => {
    setText(nextText)
    setIsTyped(true)
    emit(nextText, parseFriendlyValue(nextText, format))
  }

  const handlePicked = (picked: string) => {
    const nextValue = parseFriendlyValue(picked, format)
    const nextText = formatFriendlyValue(nextValue, format)
    setText(nextText)
    setIsTyped(false)
    emit(nextText, nextValue)
  }

  const openPicker = () => {
    const picker = pickerRef.current
    if (!picker) return
    try {
      picker.showPicker()
    } catch {
      // Older browsers (or a picker that is already open) — fall back to focusing it.
      picker.focus()
      picker.click()
    }
  }

  const invalid = !!text.trim() && !parseFriendlyDate(text)
  const preview = isTyped && !invalid ? formatFriendlyPreview(text, format) : ''
  const outOfRange = invalid ? null : rangeMessage(value, format, min, max)
  const errorText = invalid ? (invalidMessage ?? INVALID[format]) : outOfRange
  const hasFeedback = !!preview || !!errorText
  const describedByIds = [describedBy, hasFeedback ? feedbackId : null].filter(Boolean).join(' ') || undefined
  const pickerEnabled = showPicker && !disabled && !readOnly
  const timed = optionalTime && value.includes('T')
  const changeTime = (clock: string) => {
    const date = value.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    handlePicked(clock ? `${date}T${clock}` : date)
  }

  return (
    <div className={cn('relative flex flex-col gap-1', wrapperClassName)}>
      <div className="relative">
        <Input
          {...inputProps}
          ref={textInputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder ?? PLACEHOLDER[format]}
          disabled={disabled}
          readOnly={readOnly}
          value={text}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={describedByIds}
          // pr-9 last so a caller's px-* never slides text under the calendar button.
          className={cn(className, showPicker && 'pr-9')}
          onChange={(event) => handleText(event.target.value)}
        />
        {showPicker && (
          <>
            <button
              type="button"
              aria-label={calendarLabel ?? 'Open calendar'}
              title="Pick from a calendar"
              disabled={!pickerEnabled}
              onClick={openPicker}
              className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted transition-colors hover:bg-goms-sky/[0.14] hover:text-goms-navy focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name="Calendar" size={14} />
            </button>
            <input
              ref={pickerRef}
              type={format === 'date' || optionalTime ? 'date' : 'datetime-local'}
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
              value={optionalTime ? value.slice(0, 10) : pickerValue(value, format)}
              min={min ? optionalTime ? min.slice(0, 10) : pickerValue(min, format) : undefined}
              max={max ? optionalTime ? max.slice(0, 10) : pickerValue(max, format) : undefined}
              disabled={!pickerEnabled}
              onChange={(event) => handlePicked(optionalTime && timed && event.target.value ? `${event.target.value}${value.slice(10)}` : event.target.value)}
            />
          </>
        )}
      </div>
      {optionalTime && <div className="flex flex-wrap items-center gap-2 text-xs">
        {timeOpen || timed ? <>
          <input type="time" aria-label={`Time for ${inputProps['aria-label'] ?? 'date'}`} value={timed ? value.slice(11, 16) : ''}
            disabled={disabled || readOnly || !value} onChange={event => changeTime(event.target.value)}
            className="h-7 rounded border border-line bg-white px-2 text-ink focus-visible:focus-ring" />
          <button type="button" disabled={disabled || readOnly} className="text-muted underline" onClick={() => { changeTime(''); setTimeOpen(false) }}>Remove time</button>
          {!value && <span className="text-muted">Choose a date first.</span>}
        </> : <button type="button" disabled={disabled || readOnly} className="inline-flex items-center gap-1 text-goms-navy hover:underline disabled:opacity-40" onClick={() => setTimeOpen(true)}>
          <Icon name="Clock" size={12} /> Add time
        </button>}
      </div>}
      {hasFeedback && (
        <div id={feedbackId} className={cn(floatingFeedback && 'absolute left-0 top-full z-20 mt-1 min-w-full whitespace-nowrap')}>
          {preview && (
            <div className="rounded border border-dashed border-goms-sky bg-goms-sky/[0.06] px-2 py-1 text-[11px] text-goms-navy">
              Captured: {preview}
            </div>
          )}
          {errorText && (
            <span role="alert" className={cn('block text-[11px] text-crimson', floatingFeedback && 'rounded bg-white px-2 py-1 shadow-sm')}>
              {errorText}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

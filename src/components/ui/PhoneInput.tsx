import { Input } from './Field'

const NUMBER_LEN = 10

const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** Parse any stored phone string down to its bare digits (best-effort).
 *  Handles values already in canonical form, bare 10-digit numbers, and
 *  numbers that still carry a leading 91 country code — stripped textually
 *  first, not by digit-counting on the fully-digit-stripped string (a
 *  length-based guard can't tell the literal "+91" prefix's digits apart
 *  from real number digits once digits and prefix are already mixed). */
function parsePhone(value: string): string {
  const rest = value.trim().replace(/^\+?91[\s-]?/, '')
  return onlyDigits(rest).slice(0, NUMBER_LEN)
}

/** Canonical stored form: "+91 9812345678". Empty → empty string. */
export function formatPhone(number: string): string {
  const d = onlyDigits(number).slice(0, NUMBER_LEN)
  return d ? `+91 ${d}` : ''
}

/** Valid when empty (optional) or exactly 10 digits after the +91 prefix. */
export function isValidPhone(value: string): boolean {
  if (!value.trim()) return true
  return parsePhone(value).length === NUMBER_LEN
}

interface Props {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}

/** Indian contact number: a fixed +91 prefix plus a single 10-digit field.
 *  Emits the combined canonical string. */
export function PhoneInput({ value, onChange, invalid }: Props) {
  const number = parsePhone(value)
  const errorCls = invalid ? 'border-crimson focus:border-crimson' : ''

  return (
    <div className="flex items-stretch gap-2">
      <span className="flex h-10 shrink-0 select-none items-center rounded-lg border border-line bg-panel px-3 text-sm font-medium text-ink-700">
        +91
      </span>
      <Input
        value={number}
        onChange={(e) => onChange(formatPhone(e.target.value))}
        inputMode="numeric"
        maxLength={NUMBER_LEN}
        placeholder="9812345678"
        aria-label="Phone number (10 digits)"
        className={`flex-1 ${errorCls}`}
      />
    </div>
  )
}

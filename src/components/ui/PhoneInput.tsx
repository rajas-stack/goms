import { Input } from './Field'

const NUMBER_LEN = 10
// A landline's local part is 6-8 digits after a 2-4 digit STD code (not
// counting the leading 0, which we treat the same as the +91 prefix — see
// parsePhone) — so the combined digit string can run from 8 up to 12.
const LANDLINE_MIN_LEN = 8
const LANDLINE_MAX_LEN = 12

export type PhoneMode = 'mobile' | 'mobileOrLandline'

function maxLenFor(mode: PhoneMode): number {
  return mode === 'mobileOrLandline' ? LANDLINE_MAX_LEN : NUMBER_LEN
}

const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** Parse any stored phone string down to its bare digits (best-effort).
 *  Handles values already in canonical form, bare numbers, and numbers that
 *  still carry a leading 91 country code — stripped textually first, not by
 *  digit-counting on the fully-digit-stripped string (a length-based guard
 *  can't tell the literal "+91" prefix's digits apart from real number
 *  digits once digits and prefix are already mixed). `mode` is 'mobile' by
 *  default, preserving the original 10-digit-only behavior unchanged. */
function parsePhone(value: string, mode: PhoneMode = 'mobile'): string {
  const rest = value.trim().replace(/^\+?91[\s-]?/, '')
  return onlyDigits(rest).slice(0, maxLenFor(mode))
}

/** Canonical stored form: "+91 9812345678". Empty → empty string. */
export function formatPhone(number: string, mode: PhoneMode = 'mobile'): string {
  const d = onlyDigits(number).slice(0, maxLenFor(mode))
  return d ? `+91 ${d}` : ''
}

/** Valid when empty (optional). In the default 'mobile' mode, valid only at
 *  exactly 10 digits after the +91 prefix — unchanged from before `mode`
 *  existed. In 'mobileOrLandline' mode, a 10-digit mobile is still valid,
 *  and so is an STD-code-prefixed landline (2-4 digit code + 6-8 digit local
 *  number, i.e. 8-12 digits total). */
export function isValidPhone(value: string, mode: PhoneMode = 'mobile'): boolean {
  if (!value.trim()) return true
  const digits = parsePhone(value, mode)
  if (digits.length === NUMBER_LEN) return true
  if (mode !== 'mobileOrLandline') return false
  return digits.length >= LANDLINE_MIN_LEN && digits.length <= LANDLINE_MAX_LEN
}

interface Props {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  /** 'mobile' (default) keeps the original fixed-10-digit field, unchanged —
   *  every existing caller (e.g. the Employee form's phone field) is
   *  unaffected. 'mobileOrLandline' widens the single free-text field to
   *  also accept an STD-code-prefixed landline number. */
  mode?: PhoneMode
}

/** Indian contact number: a fixed +91 prefix plus a single free-text field.
 *  Emits the combined canonical string. */
export function PhoneInput({ value, onChange, invalid, mode = 'mobile' }: Props) {
  const number = parsePhone(value, mode)
  const errorCls = invalid ? 'border-crimson focus:border-crimson' : ''
  const placeholder = mode === 'mobileOrLandline' ? '9812345678 or 0674 2345678' : '9812345678'
  const ariaLabel = mode === 'mobileOrLandline' ? 'Phone number (mobile or STD + landline)' : 'Phone number (10 digits)'

  return (
    <div className="flex items-stretch gap-2">
      <span className="flex h-10 shrink-0 select-none items-center rounded-lg border border-line bg-panel px-3 text-sm font-medium text-ink-700">
        +91
      </span>
      <Input
        value={number}
        onChange={(e) => onChange(formatPhone(e.target.value, mode))}
        inputMode="numeric"
        maxLength={maxLenFor(mode)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`flex-1 ${errorCls}`}
      />
    </div>
  )
}

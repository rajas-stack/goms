import { Input } from './Field'

const MOBILE_LEN = 10
// A landline/EPBX local number, entered separately from its STD code (the
// STD code is its own field elsewhere in the form) — 6-8 digits, matching
// the local-part length of a real Indian STD-prefixed number.
const LOCAL_MIN_LEN = 6
const LOCAL_MAX_LEN = 8

export type PhoneMode = 'mobile' | 'landlineLocal'

function maxLenFor(mode: PhoneMode): number {
  return mode === 'landlineLocal' ? LOCAL_MAX_LEN : MOBILE_LEN
}

const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** Parse any stored phone string down to its bare digits (best-effort).
 *  Strips a leading "+91"/"91" textually first (not by digit-counting on the
 *  fully-digit-stripped string, which can't tell the prefix's digits apart
 *  from real number digits once mixed) — this also cleans up any legacy
 *  landline value that was saved back when this field wrongly carried a +91
 *  prefix alongside an STD code. */
function parsePhone(value: string, mode: PhoneMode = 'mobile'): string {
  const rest = value.trim().replace(/^\+?91[\s-]?/, '')
  return onlyDigits(rest).slice(0, maxLenFor(mode))
}

/** Canonical stored form. Mobile: "+91 9812345678" — a real international
 *  dialing representation. Landline-local: bare digits only ("2345678") —
 *  never combined with +91, since a domestic STD-code call and a +91
 *  international mobile call are different dialing contexts; the STD code
 *  itself lives in a separate field. Empty → empty string either way. */
export function formatPhone(number: string, mode: PhoneMode = 'mobile'): string {
  const d = onlyDigits(number).slice(0, maxLenFor(mode))
  if (!d) return ''
  return mode === 'landlineLocal' ? d : `+91 ${d}`
}

/** Valid when empty (optional). 'mobile': exactly 10 digits. 'landlineLocal':
 *  6-8 digits (the local part only — STD code is validated separately). */
export function isValidPhone(value: string, mode: PhoneMode = 'mobile'): boolean {
  if (!value.trim()) return true
  const digits = parsePhone(value, mode)
  if (mode === 'landlineLocal') return digits.length >= LOCAL_MIN_LEN && digits.length <= LOCAL_MAX_LEN
  return digits.length === MOBILE_LEN
}

interface Props {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  /** 'mobile' (default): fixed +91 prefix + 10-digit number — unchanged for
   *  every existing caller (Employee/Node phone fields). 'landlineLocal': no
   *  +91 badge, just the local number after the STD code (which is its own
   *  separate field wherever this mode is used). */
  mode?: PhoneMode
}

/** Indian contact number. In 'mobile' mode: a fixed +91 prefix plus a
 *  10-digit field, emitting the combined canonical string. In
 *  'landlineLocal' mode: a bare local-number field with no country-code
 *  badge, since STD-code dialing and +91 international dialing are
 *  different contexts that must never be shown concatenated. */
export function PhoneInput({ value, onChange, invalid, mode = 'mobile' }: Props) {
  const number = parsePhone(value, mode)
  const errorCls = invalid ? 'border-crimson focus:border-crimson' : ''

  if (mode === 'landlineLocal') {
    return (
      <Input
        value={number}
        onChange={(e) => onChange(formatPhone(e.target.value, mode))}
        inputMode="numeric"
        maxLength={maxLenFor(mode)}
        placeholder="2345678"
        aria-label="Local/EPBX number"
        className={errorCls}
      />
    )
  }

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
        placeholder="9812345678"
        aria-label="Phone number (10 digits)"
        className={`flex-1 ${errorCls}`}
      />
    </div>
  )
}

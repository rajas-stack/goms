import { Input } from './Field'

const AREA_LEN = 2
const NUMBER_LEN = 8

const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** Parse any stored phone string into its two editable parts (best-effort).
 *  Handles values already in canonical form, bare 10-digit numbers, and
 *  numbers that still carry a leading 91 country code. */
export function parsePhone(value: string): { area: string; number: string } {
  let d = onlyDigits(value)
  if (d.length > AREA_LEN + NUMBER_LEN && d.startsWith('91')) d = d.slice(2)
  return { area: d.slice(0, AREA_LEN), number: d.slice(AREA_LEN, AREA_LEN + NUMBER_LEN) }
}

/** Canonical stored form: "+91 79 12345678". Empty parts → empty string. */
export function formatPhone(area: string, number: string): string {
  if (!area && !number) return ''
  return `+91 ${area}${number ? ` ${number}` : ''}`.trimEnd()
}

/** Valid when empty (optional) or exactly 2 + 8 digits after the +91 prefix. */
export function isValidPhone(value: string): boolean {
  if (!value.trim()) return true
  const { area, number } = parsePhone(value)
  return area.length === AREA_LEN && number.length === NUMBER_LEN
}

interface Props {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}

/** Three-part Indian contact number: a fixed +91 prefix, a 2-digit area code,
 *  and an 8-digit local number. Emits the combined canonical string. */
export function PhoneInput({ value, onChange, invalid }: Props) {
  const { area, number } = parsePhone(value)
  const errorCls = invalid ? 'border-crimson focus:border-crimson' : ''

  return (
    <div className="flex items-stretch gap-2">
      <span className="flex h-10 shrink-0 select-none items-center rounded-lg border border-line bg-panel px-3 text-sm font-medium text-ink-700">
        +91
      </span>
      <Input
        value={area}
        onChange={(e) => onChange(formatPhone(onlyDigits(e.target.value).slice(0, AREA_LEN), number))}
        inputMode="numeric"
        maxLength={AREA_LEN}
        placeholder="79"
        aria-label="Area code (2 digits)"
        className={`w-16 text-center ${errorCls}`}
      />
      <Input
        value={number}
        onChange={(e) => onChange(formatPhone(area, onlyDigits(e.target.value).slice(0, NUMBER_LEN)))}
        inputMode="numeric"
        maxLength={NUMBER_LEN}
        placeholder="12345678"
        aria-label="Number (8 digits)"
        className={`flex-1 ${errorCls}`}
      />
    </div>
  )
}

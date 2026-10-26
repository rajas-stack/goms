import { parseFriendlyDate, toFriendlyValue } from '@/lib/friendlyDate'

// The free-form date parser now lives in src/lib/friendlyDate.ts so every date
// field in the app shares it (components/ui/FriendlyDateInput). Re-exported
// here so existing bid-tracker imports keep working.
export { formatCapturedDate, parseFriendlyDate } from '@/lib/friendlyDate'

// A time typed at the end ("15:00", "00:00:00", "3pm") — midnight typed this way still counts.
const TYPED_TIME = /(\d:\d{2}(:\d{2})?|\d\s*[ap]m)$/i

/** Typed text as a date cell's stored value: `yyyy-mm-dd`, or `yyyy-mm-ddTHH:mm` when the field
 *  takes a time and one was typed — the time is optional. '' when the text is not a date. */
export function parseCellDate(text: string, withTime: boolean): string {
  const parsed = parseFriendlyDate(text)
  if (!parsed) return ''
  const timed = withTime && (TYPED_TIME.test(text.trim()) || parsed.getHours() + parsed.getMinutes() > 0)
  return toFriendlyValue(parsed, timed ? 'datetime-local' : 'date')
}

const CELL_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const pad = (n: number) => String(n).padStart(2, '0')

/** A stored date / date-time as cell text: "09 Oct 2026" or "09 Oct 2026, 00:00".
 *  Anything else (free text in a General field) is shown as stored. */
export function formatCellDate(value: string): string {
  const text = value.trim()
  const m = CELL_DATE.exec(text)
  if (!m) return value
  // An instant (…Z / +05:30) shows in local time; a local date(-time) shows as stored.
  const d = m[6] ? new Date(text) : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  if (Number.isNaN(d.getTime()) || (!m[6] && d.getDate() !== Number(m[3]))) return value
  const day = `${pad(d.getDate())} ${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`
  return m[4] ? `${day}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : day
}

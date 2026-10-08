// Calendar-day arithmetic for the timeline. Everything is done in whole UTC
// days so a DST shift or the viewer's timezone can never move a date by one.
import type { IsoDate } from './types'

const MS_PER_DAY = 86_400_000
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `YYYY-MM-DD` → whole days since the Unix epoch (UTC). NaN when unparseable. */
export function toDay(iso: IsoDate): number {
  const m = ISO_DAY.exec(iso)
  if (!m) return Number.NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY
}

/** Day number (fractions are floored) → `YYYY-MM-DD`. */
export function fromDay(day: number): IsoDate {
  return new Date(Math.floor(day) * MS_PER_DAY).toISOString().slice(0, 10)
}

export const addDays = (iso: IsoDate, days: number): IsoDate => fromDay(toDay(iso) + days)
export const diffDays = (from: IsoDate, to: IsoDate): number => toDay(to) - toDay(from)

/** A date or timestamp → the calendar day the viewer sees it on (their local day). */
export function calendarDay(value: string | null | undefined): IsoDate | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** en-IN style: `16 Jan 2026`. Built by hand so ICU differences ("Sept") never leak in. */
export function formatTimelineDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '—'
  const m = ISO_DAY.exec(iso)
  if (!m) return iso
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** `16 Jan` — for dense labels where the year is implied by context. */
export function formatShortDate(iso: IsoDate): string {
  const m = ISO_DAY.exec(iso)
  if (!m) return iso
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]}`
}

export const pluralDays = (n: number): string => `${n} day${Math.abs(n) === 1 ? '' : 's'}`

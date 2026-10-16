import type { FiscalCalendar, ReportPeriod, TimeGrain } from './types.js'

/** Time buckets and report periods. Indian financial year (FY) runs April–March and is named by the year it ENDS in:
 *  FY27 = 1 Apr 2026 – 31 Mar 2027, so H1 FY27 = Apr–Sep 2026 and Q1 FY27 = Apr–Jun 2026. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `YYYY-MM-DD` from an ISO date or timestamp; null when it is not a readable date. */
export function isoDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!match) return null
  const month = Number(match[2]), day = Number(match[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? match[0] : null
}

interface Parts { year: number; month: number }
const parts = (day: string): Parts => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) })

/** The financial year a date falls in (FY27 → 2027). */
export function fiscalYear(day: string): number {
  const { year, month } = parts(day)
  return month >= 4 ? year + 1 : year
}

/** 1-based month within the year: April = 1 for FY, January = 1 for calendar. */
function periodMonth(day: string, calendar: FiscalCalendar): number {
  const { month } = parts(day)
  return calendar === 'fy' ? ((month + 8) % 12) + 1 : month
}

const short = (year: number) => String(year).slice(-2)

export interface Bucket { key: string; label: string }

/** The bucket a date falls in. Keys sort chronologically as strings. */
export function bucketOf(value: unknown, grain: TimeGrain, calendar: FiscalCalendar = 'fy'): Bucket | null {
  const day = isoDay(value)
  if (!day) return null
  const { year, month } = parts(day)
  if (grain === 'day') return { key: day, label: `${Number(day.slice(8, 10))} ${MONTHS[month - 1]} ${year}` }
  if (grain === 'month') return { key: day.slice(0, 7), label: `${MONTHS[month - 1]} ${year}` }
  const fy = calendar === 'fy', y = fy ? fiscalYear(day) : year, m = periodMonth(day, calendar)
  const prefix = fy ? `FY${y}` : String(y), name = fy ? `FY${short(y)}` : String(y)
  if (grain === 'quarter') { const q = Math.ceil(m / 3); return { key: `${prefix}-Q${q}`, label: `Q${q} ${name}` } }
  if (grain === 'half') { const h = m <= 6 ? 1 : 2; return { key: `${prefix}-H${h}`, label: `H${h} ${name}` } }
  return { key: prefix, label: name }
}

export interface DateRange { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0')
function addMonths(year: number, month: number, delta: number): Parts {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const startOf = (p: Parts) => `${p.year}-${pad(p.month)}-01`
const endOf = (p: Parts) => `${p.year}-${pad(p.month)}-${pad(lastDay(p.year, p.month))}`

/** First month of a FY / calendar year. */
const yearStart = (year: number, calendar: FiscalCalendar): Parts => (calendar === 'fy' ? { year: year - 1, month: 4 } : { year, month: 1 })

function span(year: number, calendar: FiscalCalendar, offsetMonths: number, months: number): DateRange {
  const first = addMonths(yearStart(year, calendar).year, yearStart(year, calendar).month, offsetMonths)
  const last = addMonths(first.year, first.month, months - 1)
  return { from: startOf(first), to: endOf(last) }
}

/** The inclusive date range of a report period, or null for "all time" / an incomplete period. */
export function periodRange(period: ReportPeriod, calendar: FiscalCalendar = 'fy'): DateRange | null {
  if (period.kind === 'custom') {
    const from = isoDay(period.from), to = isoDay(period.to)
    return from && to && from <= to ? { from, to } : null
  }
  if (period.kind === 'all' || !period.fy || !Number.isInteger(period.fy)) return null
  if (period.kind === 'fy') return span(period.fy, calendar, 0, 12)
  if (period.kind === 'half' && (period.half === 1 || period.half === 2)) return span(period.fy, calendar, (period.half - 1) * 6, 6)
  if (period.kind === 'quarter' && period.quarter && period.quarter >= 1 && period.quarter <= 4) return span(period.fy, calendar, (period.quarter - 1) * 3, 3)
  return null
}

const dayNumber = (day: string) => Date.UTC(parts(day).year, parts(day).month - 1, Number(day.slice(8, 10))) / 86_400_000
const fromNumber = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10)

/** The equally long range immediately before `range` (H1 → previous H2, Q2 → Q1, a custom 30 days → the 30 before). */
export function previousRange(range: DateRange): DateRange {
  const from = parts(range.from), to = parts(range.to)
  const wholeMonths = range.from.endsWith('-01') && range.to === endOf(to)
  if (wholeMonths) {
    const months = (to.year - from.year) * 12 + (to.month - from.month) + 1
    const first = addMonths(from.year, from.month, -months), last = addMonths(from.year, from.month, -1)
    return { from: startOf(first), to: endOf(last) }
  }
  const length = dayNumber(range.to) - dayNumber(range.from) + 1
  return { from: fromNumber(dayNumber(range.from) - length), to: fromNumber(dayNumber(range.from) - 1) }
}

/** Whole days from `from` to `to` (negative when `to` is earlier); null when either is not a date. */
export function daysBetween(from: unknown, to: unknown): number | null {
  const a = isoDay(from), b = isoDay(to)
  return a && b ? dayNumber(b) - dayNumber(a) : null
}

/** The current FY (or calendar year) and half for `today` — the default report period. */
export function currentPeriod(today: string, calendar: FiscalCalendar = 'fy'): { fy: number; half: 1 | 2; quarter: 1 | 2 | 3 | 4 } {
  const m = periodMonth(today, calendar)
  return { fy: calendar === 'fy' ? fiscalYear(today) : parts(today).year, half: m <= 6 ? 1 : 2, quarter: Math.ceil(m / 3) as 1 | 2 | 3 | 4 }
}

export function periodLabel(period: ReportPeriod, calendar: FiscalCalendar = 'fy'): string {
  const name = (y: number) => (calendar === 'fy' ? `FY${short(y)}` : String(y))
  if (period.kind === 'all') return 'All time'
  if (period.kind === 'custom') return period.from && period.to ? `${period.from} to ${period.to}` : 'Custom range'
  if (!period.fy) return 'All time'
  if (period.kind === 'fy') return name(period.fy)
  if (period.kind === 'half') return `H${period.half ?? 1} ${name(period.fy)}`
  return `Q${period.quarter ?? 1} ${name(period.fy)}`
}

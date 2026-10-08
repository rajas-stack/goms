import { friendlyValueToDate, parseFriendlyDate } from '@/lib/friendlyDate'
import { GENERAL_FIELDS, type GeneralField, type GeneralValues } from '../generalFields'

export const DAY_MS = 86_400_000

/** Short names for the chart, where the full General labels do not fit. */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  publishingDate: 'Published',
  receivingDate: 'Tender receiving',
  queriesDeadline: 'Queries due',
  preBidMeeting: 'Pre-bid meeting',
  bidDeadline: 'Bid submission',
  technicalOpening: 'Technical opening',
  currentContractEnd: 'Current contract ends',
}

export interface RfpDate {
  key: string
  /** The General field label: what the date is for. */
  label: string
  shortLabel: string
  raw: string
  date: Date
  hasTime: boolean
}

export interface RfpUnreadable { key: string; label: string; raw: string }

export interface RfpTimeline { dates: RfpDate[]; unreadable: RfpUnreadable[] }

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const spaced = (text: string) => text.replace(/[,-]/g, ' ').replace(/\s+/g, ' ').trim()
/** Date shapes found inside free text, each with how to hand it to the parser. */
const DATE_PATTERNS: readonly { pattern: RegExp; normalize: (text: string) => string }[] = [
  { pattern: /\b\d{4}-\d{2}-\d{2}\b/, normalize: text => text },
  { pattern: /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/, normalize: text => text.replace(/[.-]/g, '/') },
  { pattern: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?[\\s-]+${MONTH},?[\\s-]+\\d{2,4}\\b`, 'i'), normalize: spaced },
  { pattern: new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'i'), normalize: spaced },
]
const TIME_PATTERN = /\b(\d{1,2}(?:[:.]\d{2})\s*(?:[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?)(?![\w])/i

function normalizeTime(text: string): string {
  return text.replace(/\./g, (dot, offset, whole) => (/\d/.test(whole[offset + 1] ?? '') ? ':' : '')).replace(/\s+/g, '')
}

/** Finds a date (and a time, when one is written) inside free text such as
 *  "05.11.2026 at 11:00 AM, Conference Hall, New Delhi". */
export function extractDate(text: string): { date: Date; hasTime: boolean } | null {
  const source = text.replace(/\b12\s*noon\b/gi, '12pm').replace(/\bnoon\b/gi, '12pm').replace(/\bmidnight\b/gi, '12am')
  for (const { pattern, normalize } of DATE_PATTERNS) {
    const match = pattern.exec(source)
    if (!match) continue
    const datePart = normalize(match[0])
    const day = parseFriendlyDate(datePart)
    if (!day) continue
    const rest = source.slice(0, match.index) + ' ' + source.slice(match.index + match[0].length)
    const time = TIME_PATTERN.exec(rest)
    const withTime = time ? parseFriendlyDate(`${datePart} ${normalizeTime(time[1])}`) : null
    return withTime ? { date: withTime, hasTime: true } : { date: day, hasTime: false }
  }
  return null
}

function readDate(field: GeneralField, raw: string): { date: Date; hasTime: boolean } | null {
  if (field.kind === 'date') {
    const date = friendlyValueToDate(raw, 'date')
    if (date) return { date, hasTime: false }
  }
  if (field.kind === 'datetime') {
    const date = friendlyValueToDate(raw, 'datetime-local')
    if (date) return { date, hasTime: true }
  }
  return extractDate(raw)
}

/** Every dated General field, oldest first (ties keep General's order), plus
 *  the filled-in ones that could not be read as a date. */
export function buildRfpTimeline(values: GeneralValues, fields: readonly GeneralField[] = GENERAL_FIELDS): RfpTimeline {
  const dates: RfpDate[] = []
  const unreadable: RfpUnreadable[] = []
  for (const field of fields) {
    if (field.kind !== 'date' && field.kind !== 'datetime' && !field.timeline) continue
    const raw = (values[field.key] ?? '').trim()
    if (!raw) continue
    const read = readDate(field, raw)
    if (read) dates.push({ key: field.key, label: field.label, shortLabel: SHORT_LABELS[field.key] ?? field.label, raw, ...read })
    else unreadable.push({ key: field.key, label: field.label, raw })
  }
  const order = new Map(fields.map((field, index) => [field.key, index]))
  const sorted = [...dates].sort((a, b) => a.date.getTime() - b.date.getTime() || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
  return { dates: sorted, unreadable }
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Whole calendar days from `from` to `to` (DST-safe). */
export function calendarDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS)
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/** "+12 days", "+3 h 30 min", or "Same day" — the gap after the previous date. */
export function gapLabel(previous: RfpDate, current: RfpDate): string {
  const days = calendarDays(previous.date, current.date)
  if (days > 0) return `+${plural(days, 'day')}`
  const minutes = Math.round((current.date.getTime() - previous.date.getTime()) / 60_000)
  if (!previous.hasTime || !current.hasTime || minutes <= 0) return 'Same day'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `+${[hours ? `${hours} h` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ')}`
}

export type RfpStatus = 'past' | 'today' | 'upcoming'

export function statusOf(entry: RfpDate, now: Date): RfpStatus {
  const days = calendarDays(now, entry.date)
  if (days < 0) return 'past'
  if (days > 0) return 'upcoming'
  if (entry.hasTime) return entry.date.getTime() < now.getTime() ? 'past' : 'today'
  return 'today'
}

/** "in 5 days", "3 days ago", "Today". */
export function relativeLabel(entry: RfpDate, now: Date): string {
  const days = calendarDays(now, entry.date)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} ago`
}

export function formatRfpDate(entry: Pick<RfpDate, 'date' | 'hasTime'>): string {
  const day = entry.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  if (!entry.hasTime) return day
  return `${day}, ${entry.date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`
}

/** Dates sharing a calendar day become one marker on the chart. */
export interface RfpMarker { id: string; date: Date; position: number; items: RfpDate[] }
export interface RfpPhase { from: RfpMarker; to: RfpMarker; days: number; status: 'past' | 'current' | 'future'; progress: number }
export interface RfpChartLayout { markers: RfpMarker[]; phases: RfpPhase[]; todayPosition: number | null }

const EDGE = 0.04

/** Positions (0..1) proportional to time between the first and last date. */
export function layoutChart(dates: readonly RfpDate[], now: Date): RfpChartLayout {
  if (!dates.length) return { markers: [], phases: [], todayPosition: null }
  const groups: RfpDate[][] = []
  for (const entry of dates) {
    const last = groups[groups.length - 1]
    if (last && calendarDays(last[0].date, entry.date) === 0) last.push(entry)
    else groups.push([entry])
  }
  const first = startOfDay(dates[0].date)
  const lastDay = startOfDay(dates[dates.length - 1].date)
  const single = first === lastDay
  const start = single ? first - 7 * DAY_MS : first
  const end = single ? lastDay + 7 * DAY_MS : lastDay
  const place = (time: number) => EDGE + ((time - start) / (end - start)) * (1 - 2 * EDGE)
  const markers = groups.map(items => ({ id: items.map(item => item.key).join('+'), date: items[0].date, position: place(startOfDay(items[0].date)), items }))
  const today = startOfDay(now)
  const phases = markers.slice(1).map((to, index) => {
    const from = markers[index]
    const fromDay = startOfDay(from.date)
    const toDay = startOfDay(to.date)
    const status = today >= toDay ? 'past' as const : today <= fromDay ? 'future' as const : 'current' as const
    const progress = status === 'past' ? 1 : status === 'future' ? 0 : (today - fromDay) / (toDay - fromDay)
    return { from, to, days: calendarDays(from.date, to.date), status, progress }
  })
  const todayPosition = today >= start && today <= end ? place(today) : null
  return { markers, phases, todayPosition }
}

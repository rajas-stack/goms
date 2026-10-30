/** One Google Calendar event, already parsed for display. */
export interface CalEvent {
  id: string
  title: string
  start: Date
  /** Exclusive, like Google's own end. */
  end: Date
  allDay: boolean
  location?: string
  description?: string
  meetUrl?: string
  htmlLink?: string
  color: string
  attendees: number
}

/** Google's event palette by colorId; uncoloured events use the calendar blue. */
const EVENT_COLORS: Record<string, string> = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
}
export const DEFAULT_COLOR = '#039be5'

export interface GoogleEvent {
  id: string; summary?: string; description?: string; location?: string; colorId?: string; htmlLink?: string; hangoutLink?: string; status?: string
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; attendees?: unknown[]
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
}

/** Local midnight for a YYYY-MM-DD all-day date (Date.parse would read it as UTC). */
const localDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }

export function parseEvent(e: GoogleEvent): CalEvent | null {
  if (e.status === 'cancelled' || !e.start || !e.end) return null
  const allDay = !e.start.dateTime
  const start = allDay ? localDate(e.start.date!) : new Date(e.start.dateTime!)
  const end = allDay ? localDate(e.end.date!) : new Date(e.end.dateTime!)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri
  return {
    id: e.id, title: e.summary?.trim() || '(No title)', start, end, allDay, location: e.location, description: e.description,
    meetUrl: e.hangoutLink || video, htmlLink: e.htmlLink, color: (e.colorId && EVENT_COLORS[e.colorId]) || DEFAULT_COLOR, attendees: e.attendees?.length ?? 0,
  }
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Six Monday-first weeks covering the month, so the grid never changes height. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i))
}

/** Day keys an event covers (multi-day and all-day events appear on every day they touch). */
export function eventDays(e: CalEvent): string[] {
  const days: string[] = []
  const lastMoment = new Date(e.end.getTime() - 1)
  for (let d = new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate()); d <= lastMoment && days.length < 62; d = addDays(d, 1)) days.push(dayKey(d))
  return days.length ? days : [dayKey(e.start)]
}

export function byDay(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()
  for (const e of events) for (const k of eventDays(e)) map.set(k, [...(map.get(k) ?? []), e])
  for (const list of map.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
  return map
}

/** "in 2 h 5 min", "Now · 12 min left", "Ended". */
export function countdown(now: number, e: CalEvent): string {
  const mins = (ms: number) => Math.max(1, Math.round(ms / 60000))
  const span = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)
  if (now < e.start.getTime()) return `in ${span(mins(e.start.getTime() - now))}`
  if (now < e.end.getTime()) return `Now · ${span(mins(e.end.getTime() - now))} left`
  return 'Ended'
}

/** Hours booked on a day by timed events (overlaps counted once). */
export function bookedHours(events: CalEvent[], day: Date): number {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(), to = from + 86_400_000
  const spans = events.filter((e) => !e.allDay).map((e) => [Math.max(from, e.start.getTime()), Math.min(to, e.end.getTime())] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  let total = 0, cursor = from
  for (const [a, b] of spans) { const s = Math.max(a, cursor); if (b > s) { total += b - s; cursor = b } }
  return Math.round((total / 3_600_000) * 10) / 10
}

export const timeLabel = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

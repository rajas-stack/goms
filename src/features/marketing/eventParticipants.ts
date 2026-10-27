import * as XLSX from 'xlsx'
import type { HierNode } from '@goms/domain'
import type { Employee } from '@/lib/types'

export interface Participant { name: string; designation: string; dept: string; state: string }

/** What Marketing records about an event before the participant upload. All optional so older events still load. */
export interface EventDetails {
  state: string
  city: string
  venue: string
  /** Start time, HH:MM. */
  time: string
  days: number
  domain: string
  type: string
  organiser: string
  /** How we take part: attendee, speaker, sponsor, exhibitor… */
  role: string
  objective: string
  website: string
  notes: string
}

export interface MarketingEvent extends Partial<EventDetails> {
  id: string
  name: string
  /** Start date, YYYY-MM-DD. */
  date: string
  participants: Participant[]
  /** Directory people this event's upload created; absent on events saved before it was tracked. */
  addedIds?: string[]
  /** Hidden from the event list until "Show archived"; nothing else changes. */
  archived?: boolean
}

/** Blank designations are stored as this, since a Directory person needs one. */
export const NO_DESIGNATION = '—'

export const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

const HEADERS: Record<keyof Participant, RegExp> = { name: /name/i, designation: /designation|title|role/i, dept: /dep(ar)?t/i, state: /state/i }

/** Header row decides the columns (Name / Designation / Dept / State, any order); rows without a name are dropped. */
export function parseParticipants(rows: string[][]): Participant[] {
  const [header = [], ...body] = rows
  const col = (k: keyof Participant) => header.findIndex((h) => HEADERS[k].test(h))
  const [n, d, dp, st] = [col('name'), col('designation'), col('dept'), col('state')]
  if (n < 0) throw new Error('The file needs a "Name" column in its first row.')
  const cell = (row: string[], i: number) => (i < 0 ? '' : String(row[i] ?? '').trim())
  return body.map((r) => ({ name: cell(r, n), designation: cell(r, d), dept: cell(r, dp), state: cell(r, st) })).filter((p) => p.name)
}

export function readParticipantsFile(data: ArrayBuffer): Participant[] {
  const sheet = XLSX.read(data, { type: 'array' })
  const first = sheet.Sheets[sheet.SheetNames[0]]
  if (!first) return []
  return parseParticipants(XLSX.utils.sheet_to_json<string[]>(first, { header: 1, blankrows: false, raw: false, defval: '' }))
}

/** The Directory person each participant already is, by name (case/space-insensitive); null when new. */
export function matchParticipants(participants: readonly Participant[], people: readonly Employee[]): (Employee | null)[] {
  const byName = new Map<string, Employee>()
  // A connected record wins when the same name exists twice.
  for (const p of people) if (!byName.has(nameKey(p.name)) || p.connected) byName.set(nameKey(p.name), p)
  return participants.map((p) => byName.get(nameKey(p.name)) ?? null)
}

/** One review row per distinct dept + state in the file. */
export const deptKey = (p: Pick<Participant, 'dept' | 'state'>) => `${nameKey(p.dept)}|${nameKey(p.state)}`

/** Directory department for each dept key: same name, narrowed by state when the file gives one; '' when none or still ambiguous. */
export function autoMatchDepartments(participants: readonly Participant[], departments: readonly HierNode[], stateNames: ReadonlyMap<number, string>): Map<string, string> {
  const result = new Map<string, string>()
  for (const p of participants) {
    const key = deptKey(p)
    if (result.has(key)) continue
    let hits = departments.filter((d) => nameKey(d.name) === nameKey(p.dept))
    if (p.state && hits.length > 1) hits = hits.filter((d) => d.stateCode != null && nameKey(stateNames.get(d.stateCode) ?? '') === nameKey(p.state))
    result.set(key, hits.length === 1 ? hits[0].id : '')
  }
  return result
}

/** The state code a file's State cell names (case/space-insensitive), or null. */
export function stateCodeFor(state: string, stateNames: ReadonlyMap<number, string>): number | null {
  for (const [code, name] of stateNames) if (state && nameKey(name) === nameKey(state)) return code
  return null
}

/** People the event's upload put in the Directory. Older events didn't record ids, so for them it's every unconnected
 *  person with a participant's name and designation — a guess the user verifies before anything is removed. */
export function addedByEvent(event: MarketingEvent, people: readonly Employee[]): Employee[] {
  if (event.addedIds) {
    const ids = new Set(event.addedIds)
    return people.filter((p) => ids.has(p.id))
  }
  const uploaded = new Set(event.participants.map((p) => `${nameKey(p.name)}|${nameKey(p.designation || NO_DESIGNATION)}`))
  return people.filter((p) => !p.connected && uploaded.has(`${nameKey(p.name)}|${nameKey(p.designation)}`))
}

/** Events this Directory person took part in: added by the event, or listed in it under the same name. */
export function eventsForPerson(events: readonly MarketingEvent[], person: Pick<Employee, 'id' | 'name'>): MarketingEvent[] {
  return events.filter((e) => e.addedIds?.includes(person.id) || e.participants.some((p) => nameKey(p.name) === nameKey(person.name)))
}

/** "Connected" = already in the Directory, tracked as a relationship contact. */
export const isConnected = (person: Employee | null): person is Employee => !!person?.connected

const KEY = 'goms:marketing-events'

// shortcut: events live in this browser's localStorage only; move to an API table when they must be shared across users/devices.
export function loadEvents(): MarketingEvent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as MarketingEvent[]) : []
  } catch { return [] }
}

export function saveEvents(events: readonly MarketingEvent[]) {
  try { localStorage.setItem(KEY, JSON.stringify(events)) } catch { /* storage full or blocked: the in-memory list still shows */ }
}

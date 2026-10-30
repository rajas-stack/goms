import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'
import { authApi } from '@/lib/auth'
import { getAuthHeaders } from '@/data/remote/authHeaders'
import { googleApiRequest, googleFeatureToken } from '@/features/integrations/googleClient'
import { productFor } from '@/features/integrations/catalog'
import { getGoogleAccount, getGoogleSession } from '@/features/integrations/session'
import { googleSettings } from '@/features/integrations/settings'
import { dayKey, parseEvent, type CalEvent, type GoogleEvent } from './model'

const PAGE = 'calendar'
const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
/** With the GOMS server, Calendar rides on the GOMS sign-in (the server holds the user's Google login). */
const SERVER = !!import.meta.env.VITE_API_BASE_URL

/** The user's Google login doesn't include Calendar yet: server mode re-signs in, browser mode asks Google once. */
export class CalendarConsentNeeded extends Error {}

let client: ReturnType<typeof createTRPCClient<AppRouter>> | null = null
const api = () => (client ??= createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc`, fetch: authApi.fetch, headers: getAuthHeaders })] })).calendar

/** Browser-only GOMS: a cached Google token without a popup, or a consent prompt when `interactive` (call that from a click). */
async function browserToken(interactive: boolean, extra: readonly string[] = []): Promise<string> {
  const account = getGoogleAccount()
  if (!account) throw new Error('Sign in to GOMS with your Amnex Google account to see your calendar.')
  const cached = getGoogleSession([...productFor('calendar').scopes, ...extra], googleSettings(account).clientId)
  if (cached) return cached.accessToken
  if (!interactive) throw new CalendarConsentNeeded('Google Calendar needs one-time permission.')
  return googleFeatureToken('calendar', PAGE, extra)
}

/** Grants Calendar: on the server, sign in to GOMS again (Google adds Calendar to the same login); in the browser, one Google prompt. */
export async function connectCalendar() {
  if (!SERVER) { await browserToken(true); return }
  await authApi.signOut()
  window.location.assign(`/login?next=${encodeURIComponent('/calendar')}`)
}

/** Events on the signed-in user's primary calendar between two moments, recurring events expanded. */
export async function listEvents(from: Date, to: Date, max = 250): Promise<CalEvent[]> {
  let items: GoogleEvent[]
  if (SERVER) {
    const result = await api().events.query({ from: from.toISOString(), to: to.toISOString(), max })
    if (result.status === 'consent') throw new CalendarConsentNeeded('Sign in again to add Google Calendar to your GOMS login.')
    items = result.events as GoogleEvent[]
  } else {
    const params = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(max) })
    items = (await googleApiRequest<{ items?: GoogleEvent[] }>(`${BASE}?${params}`, await browserToken(false))).items ?? []
  }
  return items.map(parseEvent).filter((e): e is CalEvent => !!e)
}

export interface NewEvent { title: string; start: Date; end: Date; allDay: boolean; location: string; description: string; meet: boolean }

/** Adds an event (with an optional Meet link) to the primary calendar. */
export async function createEvent(input: NewEvent): Promise<void> {
  const when = (d: Date) => (input.allDay ? { date: dayKey(d) } : { dateTime: d.toISOString() })
  const event = { summary: input.title, location: input.location || undefined, description: input.description || undefined, start: when(input.start), end: when(input.end) }
  if (SERVER) { await api().create.mutate({ ...event, meet: input.meet }); return }
  const body = { ...event, ...(input.meet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}) }
  await googleApiRequest<GoogleEvent>(`${BASE}?conferenceDataVersion=1`, await browserToken(true, [WRITE_SCOPE]), undefined, { method: 'POST', body })
}

/** Server mode needs only the GOMS sign-in; browser mode needs the bound Google account too. */
export const calendarNeedsGoogleAccount = !SERVER

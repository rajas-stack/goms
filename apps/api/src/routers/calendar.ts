import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { CALENDAR_SCOPE } from '../email/config.js'
import { accessToken } from '../email/gmail.js'
import { emailActor } from '../email/access.js'
import type { MailboxRow } from '../email/store.js'

const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const MAX_RANGE_MS = 100 * 86_400_000
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const when = z.union([z.object({ dateTime: z.iso.datetime({ offset: true }) }).strict(), z.object({ date: day }).strict()])

/** The fields the Calendar page reads; nothing else leaves the server. */
const pick = (e: Record<string, any>) => ({
  id: String(e.id), summary: e.summary, description: e.description, location: e.location, colorId: e.colorId, htmlLink: e.htmlLink, hangoutLink: e.hangoutLink,
  status: e.status, start: e.start, end: e.end, attendees: Array.isArray(e.attendees) ? e.attendees.map(() => ({})) : undefined,
  conferenceData: e.conferenceData?.entryPoints ? { entryPoints: e.conferenceData.entryPoints.map((p: any) => ({ entryPointType: p.entryPointType, uri: p.uri })) } : undefined,
})

/** The caller's own Google login (stored at GOMS sign-in), or null when it doesn't include Calendar yet. */
async function ownCalendarLogin(ctx: Parameters<typeof emailActor>[0]): Promise<MailboxRow | null> {
  const actor = await emailActor(ctx)
  const row = (await pool.query("SELECT * FROM email_mailboxes WHERE owner_email=$1 AND provider_email=$1 AND status='connected'", [actor.email])).rows[0] as MailboxRow | undefined
  return row && row.scopes.includes(CALENDAR_SCOPE) ? row : null
}

async function google<T>(login: MailboxRow, url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const call = async (token: string) => fetch(url, {
    method: init.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  let token = await accessToken(login)
  if (!token) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Your Google sign-in expired. Sign out and sign in to GOMS again.' })
  let response = await call(token)
  if (response.status === 401) { token = await accessToken(login, true); if (token) response = await call(token) }
  if (response.status === 403) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Google Calendar is not enabled for this Google Cloud project, or access was denied.' })
  if (!response.ok) throw new TRPCError({ code: 'BAD_GATEWAY', message: `Google Calendar is unavailable (HTTP ${response.status}).` })
  return response.json() as Promise<T>
}

/** Calendar works through the GOMS login itself: the same Google consent at sign-in covers it, no second connect. */
export const calendarRouter = router({
  events: protectedReadProcedure
    .input(z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), max: z.number().int().min(1).max(250).default(250) }).strict())
    .query(async ({ input, ctx }) => {
      const from = Date.parse(input.from), to = Date.parse(input.to)
      if (!(to > from) || to - from > MAX_RANGE_MS) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick a range of up to 100 days.' })
      const login = await ownCalendarLogin(ctx)
      if (!login) return { status: 'consent' as const, events: [] }
      const params = new URLSearchParams({ timeMin: input.from, timeMax: input.to, singleEvents: 'true', orderBy: 'startTime', maxResults: String(input.max) })
      const data = await google<{ items?: Record<string, unknown>[] }>(login, `${BASE}?${params}`)
      return { status: 'ok' as const, events: (data.items ?? []).map(pick) }
    }),
  create: protectedProcedure
    .input(z.object({ summary: z.string().trim().min(1).max(200), location: z.string().max(300).optional(), description: z.string().max(4000).optional(), start: when, end: when, meet: z.boolean() }).strict())
    .mutation(async ({ input, ctx }) => {
      const login = await ownCalendarLogin(ctx)
      if (!login) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Sign out and sign in to GOMS again to allow Calendar.' })
      const body = {
        summary: input.summary, location: input.location || undefined, description: input.description || undefined, start: input.start, end: input.end,
        ...(input.meet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
      }
      return pick(await google<Record<string, unknown>>(login, `${BASE}?conferenceDataVersion=1`, { method: 'POST', body }))
    }),
})

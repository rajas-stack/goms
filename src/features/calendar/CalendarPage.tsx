import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { useGoogleAccount } from '@/features/integrations/session'
import { useAuthUser } from '@/lib/auth/useAuthUser'
import { calendarNeedsGoogleAccount, CalendarConsentNeeded, connectCalendar, createEvent, listEvents, type NewEvent } from './googleCalendar'
import { addDays, bookedHours, byDay, dayKey, monthGrid } from './model'
import { MonthGrid } from './MonthGrid'
import { DayAgenda } from './DayAgenda'
import { UpNextCard } from './UpNextCard'
import { NewEventDialog } from './NewEventDialog'

const TICK_MS = 30_000

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), TICK_MS); return () => window.clearInterval(t) }, [])
  return now
}

/** Calendar: the signed-in user's Google Calendar — month grid, day agenda and a live "up next" card. */
export function CalendarPage() {
  const reduce = useReducedMotion()
  const toast = useToast()
  const qc = useQueryClient()
  const googleAccount = useGoogleAccount()
  const { user } = useAuthUser()
  // Bound to the GOMS login: on the server that login is all it takes; browser-only GOMS also needs the linked Google account.
  const account = user?.email && (!calendarNeedsGoogleAccount || googleAccount) ? { email: user.email.toLowerCase() } : null
  const now = useNow()
  const today = new Date(now)
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth(), direction: 0 }))
  const [selected, setSelected] = useState(() => today)
  const [creating, setCreating] = useState(false)

  const grid = monthGrid(view.year, view.month)
  const range = { from: grid[0], to: addDays(grid[41], 1) }
  const month = useQuery({
    queryKey: ['google-calendar', 'range', dayKey(range.from), account?.email],
    queryFn: () => listEvents(range.from, range.to), enabled: !!account, staleTime: 60_000, retry: (n, e) => !(e instanceof CalendarConsentNeeded) && n < 1,
  })
  const upcoming = useQuery({
    queryKey: ['google-calendar', 'upcoming', account?.email],
    queryFn: () => listEvents(new Date(Date.now() - 6 * 3_600_000), addDays(new Date(), 14), 30), enabled: !!account, staleTime: 60_000, refetchInterval: 5 * 60_000,
    retry: (n, e) => !(e instanceof CalendarConsentNeeded) && n < 1,
  })
  const needsConsent = month.error instanceof CalendarConsentNeeded || upcoming.error instanceof CalendarConsentNeeded
  const connect = useMutation({ mutationFn: connectCalendar, onSuccess: () => qc.invalidateQueries({ queryKey: ['google-calendar'] }), onError: (e) => toast(e instanceof Error ? e.message : 'Could not connect Google Calendar.', undefined, 'error') })

  const days = useMemo(() => byDay(month.data ?? []), [month.data])
  const next = (upcoming.data ?? []).find((e) => !e.allDay && e.end.getTime() > now) ?? null
  const todayEvents = byDay(upcoming.data ?? []).get(dayKey(today)) ?? []

  const go = (delta: number) => setView((v) => { const d = new Date(v.year, v.month + delta, 1); return { year: d.getFullYear(), month: d.getMonth(), direction: delta } })
  const goToday = () => { const t = new Date(); setView((v) => ({ year: t.getFullYear(), month: t.getMonth(), direction: Math.sign(t.getFullYear() * 12 + t.getMonth() - (v.year * 12 + v.month)) })); setSelected(t) }
  const pick = (d: Date) => { setSelected(d); if (d.getMonth() !== view.month) go(d.getFullYear() * 12 + d.getMonth() - (view.year * 12 + view.month)) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (creating || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key.toLowerCase() === 't') goToday()
      else if (e.key.toLowerCase() === 'n') setCreating(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function create(input: NewEvent) {
    await createEvent(input)
    await qc.invalidateQueries({ queryKey: ['google-calendar'] })
    toast(`Added “${input.title}” to Google Calendar`)
  }

  const title = new Date(view.year, view.month, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto bg-[radial-gradient(ellipse_at_top_right,rgb(var(--c-panel))_0%,rgb(var(--c-paper))_60%)] p-4 sm:p-6">
      <div className="flex flex-wrap items-stretch gap-4">
        <div className="flex min-w-[260px] flex-[2] flex-col justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Google Calendar{account ? ` · ${account.email}` : ''}</p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.h1 key={title} className="font-display text-[34px] font-bold leading-tight tracking-tight text-ink-900"
                initial={reduce ? false : { opacity: 0, y: view.direction >= 0 ? 10 : -10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: view.direction >= 0 ? -10 : 10 }} transition={{ duration: 0.2 }}>
                {title}
              </motion.h1>
            </AnimatePresence>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-line bg-white p-0.5 shadow-sm">
              <button type="button" aria-label="Previous month" onClick={() => go(-1)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-900 transition-colors hover:bg-ink-900/[0.06] active:scale-95"><Icon name="ChevronLeft" size={16} /></button>
              <button type="button" onClick={goToday} className="h-8 rounded-lg px-3 text-[13px] font-semibold text-ink-900 transition-colors hover:bg-ink-900/[0.06]">Today</button>
              <button type="button" aria-label="Next month" onClick={() => go(1)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-900 transition-colors hover:bg-ink-900/[0.06] active:scale-95"><Icon name="ChevronRight" size={16} /></button>
            </div>
            <Button variant="primary" onClick={() => setCreating(true)} disabled={!account}><Icon name="Plus" size={15} />New event</Button>
            <a href="https://calendar.google.com/calendar/" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-goms-navy hover:bg-goms-navy/[0.06]">
              <Icon name="ExternalLink" size={14} />Open Google Calendar
            </a>
            {(month.isFetching || upcoming.isFetching) && <span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><Icon name="RefreshCw" size={12} className="animate-spin" />Syncing</span>}
            <span className="hidden text-[11px] text-muted xl:inline">← → months · T today · N new</span>
          </div>
        </div>
        <UpNextCard event={next} now={now} todayCount={todayEvents.length} todayHours={bookedHours(todayEvents, today)} loading={upcoming.isLoading && !!account} />
      </div>

      {!account ? (
        <Notice icon="LogIn" title="Sign in with Google" body="Your calendar appears here once you are signed in to GOMS with your Amnex Google account." />
      ) : needsConsent ? (
        <Notice icon="CalendarDays" title="Show your Google Calendar" body={calendarNeedsGoogleAccount ? 'GOMS needs one-time permission to read your calendar. Google asks once; after that it opens instantly.' : 'Your GOMS sign-in is from before Calendar was added. Sign in once more and Google adds Calendar to the same login.'}
          action={<Button variant="primary" onClick={() => connect.mutate()} disabled={connect.isPending}>{connect.isPending ? 'Connecting…' : calendarNeedsGoogleAccount ? 'Show my calendar' : 'Sign in again'}</Button>} />
      ) : month.error ? (
        <Notice icon="TriangleAlert" title="Couldn't load your calendar" body={month.error instanceof Error ? month.error.message : 'Try again in a moment.'}
          action={<Button onClick={() => void month.refetch()}>Retry</Button>} />
      ) : (
        <div className="flex min-h-[520px] flex-1 flex-col gap-4 lg:flex-row">
          <MonthGrid year={view.year} month={view.month} direction={view.direction} days={days} selected={selected} today={today} onSelect={pick} />
          <DayAgenda day={selected} events={days.get(dayKey(selected)) ?? []} now={now} onNew={() => setCreating(true)} />
        </div>
      )}

      <NewEventDialog open={creating} day={selected} onClose={() => setCreating(false)} onCreate={create} />
    </div>
  )
}

function Notice({ icon, title, body, action }: { icon: string; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-goms-navy text-paper shadow-panel"><Icon name={icon} size={22} /></span>
        <h2 className="mt-4 text-[18px] font-semibold text-ink-900">{title}</h2>
        <p className="mt-1 text-[13px] text-muted">{body}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  )
}

import { motion, useReducedMotion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { countdown, timeLabel, type CalEvent } from './model'

/** The big dark hero card: what's next, a live countdown, and a one-tap Join. */
export function UpNextCard({ event, now, todayCount, todayHours, loading }: { event: CalEvent | null; now: number; todayCount: number; todayHours: number; loading: boolean }) {
  const reduce = useReducedMotion()
  const live = !!event && now >= event.start.getTime() && now < event.end.getTime()
  const progress = live && event ? (now - event.start.getTime()) / (event.end.getTime() - event.start.getTime()) : 0
  return (
    <section aria-label="Up next" className="relative min-w-[300px] flex-1 overflow-hidden rounded-2xl bg-ink-900 p-5 text-paper shadow-panel">
      <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-indigo/35 blur-2xl" aria-hidden />
      <motion.div aria-hidden className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full blur-3xl" style={{ background: event?.color ?? '#039be5', opacity: 0.25 }}
        animate={reduce ? undefined : { scale: [1, 1.15, 1] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} />
      <p className="relative flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-paper/60">
        {live ? <><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" /></span>Happening now</> : 'Up next'}
      </p>
      {loading ? (
        <div className="relative mt-2 space-y-2"><div className="h-7 w-2/3 animate-pulse rounded bg-paper/10" /><div className="h-4 w-1/3 animate-pulse rounded bg-paper/10" /></div>
      ) : event ? (
        <motion.div key={event.id} className="relative" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <p className="mt-1 line-clamp-2 text-[26px] font-semibold leading-tight">{event.title}</p>
          <p className="mt-1 text-[13px] text-paper/70">
            {event.allDay ? 'All day' : `${timeLabel(event.start)} – ${timeLabel(event.end)}`}
            {event.location && <> · <span className="text-paper/90">{event.location}</span></>}
          </p>
          <p className={cn('mt-3 text-[32px] font-semibold leading-none tabular-nums', live ? 'text-emerald' : 'text-paper')} aria-live="polite">{countdown(now, event)}</p>
          {live && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper/15"><div className="h-full rounded-full bg-emerald transition-[width] duration-1000" style={{ width: `${progress * 100}%` }} /></div>}
          {event.meetUrl && (
            <a href={event.meetUrl} target="_blank" rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-paper px-4 py-2 text-[13px] font-semibold text-ink-900 shadow transition-transform hover:-translate-y-0.5 active:translate-y-0">
              <Icon name="Video" size={15} /> Join Google Meet
            </a>
          )}
        </motion.div>
      ) : (
        <p className="relative mt-2 text-[22px] font-semibold">Nothing scheduled — enjoy the focus time ✨</p>
      )}
      <div className="relative mt-4 flex gap-4 border-t border-paper/10 pt-3 text-[12px]">
        <span><span className="text-paper/60">Today </span><span className="font-semibold tabular-nums">{todayCount} {todayCount === 1 ? 'event' : 'events'}</span></span>
        <span><span className="text-paper/60">Booked </span><span className="font-semibold tabular-nums">{todayHours} h</span></span>
      </div>
    </section>
  )
}

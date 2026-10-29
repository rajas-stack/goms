import { motion, useReducedMotion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { sameDay, timeLabel, type CalEvent } from './model'

/** The selected day's events as a staggered timeline, with a live "now" marker on today. */
export function DayAgenda({ day, events, now, onNew }: { day: Date; events: CalEvent[]; now: number; onNew: () => void }) {
  const reduce = useReducedMotion()
  const isToday = sameDay(day, new Date(now))
  const nowIndex = isToday ? events.findIndex((e) => !e.allDay && e.start.getTime() > now) : -1
  return (
    <aside aria-label="Day agenda" className="flex min-h-0 w-full flex-col rounded-2xl border border-line bg-white lg:w-80">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{isToday ? 'Today' : day.toLocaleDateString('en-IN', { weekday: 'long' })}</p>
          <p className="text-[17px] font-semibold text-ink-900">{day.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</p>
        </div>
        <button type="button" onClick={onNew} aria-label="New event on this day"
          className="grid h-9 w-9 place-items-center rounded-xl bg-goms-navy text-paper shadow-sm transition-transform hover:rotate-90 hover:scale-105 active:scale-95">
          <Icon name="Plus" size={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 scrollbar-thin">
        {events.length === 0 && (
          <div className="grid place-items-center gap-2 px-4 py-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-goms-sky/10 text-goms-navy"><Icon name="CalendarDays" size={20} /></span>
            <p className="text-[13px] text-muted">A clear day. Tap + to plan something.</p>
          </div>
        )}
        {events.map((e, i) => {
          const live = now >= e.start.getTime() && now < e.end.getTime()
          const past = now >= e.end.getTime()
          return (
            <div key={e.id}>
              {i === nowIndex && <NowLine />}
              <motion.article initial={reduce ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduce ? 0 : i * 0.05, type: 'spring', stiffness: 300, damping: 26 }}
                className={cn('group relative overflow-hidden rounded-xl border bg-white p-3 pl-4 transition-all hover:-translate-y-0.5 hover:shadow-md', live ? 'border-emerald/50 shadow-sm' : 'border-line', past && 'opacity-60')}>
                <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: e.color }} aria-hidden />
                <p className="text-[11.5px] font-medium tabular-nums text-muted">{e.allDay ? 'All day' : `${timeLabel(e.start)} – ${timeLabel(e.end)}`}{live && <span className="ml-1.5 rounded-full bg-emerald/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald">LIVE</span>}</p>
                <p className="mt-0.5 text-[13.5px] font-semibold leading-snug text-ink-900">{e.title}</p>
                {e.location && <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted"><Icon name="MapPin" size={12} />{e.location}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {e.meetUrl && <a href={e.meetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-goms-navy px-2.5 py-1 text-[11.5px] font-semibold text-paper transition-transform hover:-translate-y-0.5"><Icon name="Video" size={12} />Join</a>}
                  {e.attendees > 0 && <span className="inline-flex items-center gap-1 text-[11.5px] text-muted"><Icon name="Users" size={12} />{e.attendees}</span>}
                  {e.htmlLink && <a href={e.htmlLink} target="_blank" rel="noreferrer" className="ml-auto text-[11.5px] font-medium text-goms-navy opacity-0 transition-opacity hover:underline group-hover:opacity-100 focus-visible:opacity-100">Open in Google</a>}
                </div>
              </motion.article>
            </div>
          )
        })}
        {isToday && nowIndex === -1 && events.length > 0 && <NowLine />}
      </div>
    </aside>
  )
}

function NowLine() {
  return (
    <div className="my-1 flex items-center gap-2" aria-label="Now">
      <span className="h-2.5 w-2.5 rounded-full bg-crimson shadow-[0_0_0_4px_rgb(178_58_72/0.18)]" />
      <span className="h-px flex-1 bg-crimson/60" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-crimson">Now</span>
    </div>
  )
}

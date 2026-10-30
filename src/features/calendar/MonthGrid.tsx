import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { dayKey, monthGrid, sameDay, type CalEvent } from './model'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_CHIPS = 3

/** Six-week month grid. Months slide in from the side you moved toward; today pulses; chips carry event colours. */
export function MonthGrid({ year, month, direction, days, selected, today, onSelect }: {
  year: number; month: number; direction: number; days: Map<string, CalEvent[]>; selected: Date; today: Date; onSelect: (d: Date) => void
}) {
  const reduce = useReducedMotion()
  const grid = monthGrid(year, month)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-white">
      <div className="grid grid-cols-7 border-b border-line bg-panel/50">
        {WEEKDAYS.map((d, i) => <div key={d} className={cn('px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider', i >= 5 ? 'text-crimson/70' : 'text-muted')}>{d}</div>)}
      </div>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div key={`${year}-${month}`} custom={direction} className="absolute inset-0 grid grid-cols-7 grid-rows-6"
            initial={reduce ? false : { x: direction * 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={reduce ? undefined : { x: direction * -60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
            {grid.map((d, i) => {
              const k = dayKey(d), list = days.get(k) ?? [], inMonth = d.getMonth() === month
              const isToday = sameDay(d, today), isSelected = sameDay(d, selected)
              return (
                <button key={k} type="button" onClick={() => onSelect(d)} aria-label={`${d.toDateString()}, ${list.length} events`} aria-pressed={isSelected}
                  className={cn('group relative flex min-h-0 flex-col gap-0.5 overflow-hidden border-b border-r border-line p-1.5 text-left transition-colors',
                    i % 7 === 6 && 'border-r-0', i >= 35 && 'border-b-0',
                    inMonth ? 'bg-white hover:bg-goms-sky/[0.06]' : 'bg-panel/40 text-muted hover:bg-panel/70',
                    isSelected && 'z-10 bg-goms-sky/[0.08] ring-2 ring-inset ring-goms-navy/70')}>
                  <span className="flex items-center justify-between">
                    <span className={cn('relative grid h-7 w-7 place-items-center rounded-full text-[12.5px] font-semibold tabular-nums transition-transform group-hover:scale-110',
                      isToday ? 'bg-goms-navy text-paper' : inMonth ? 'text-ink-900' : 'text-muted/70')}>
                      {isToday && !reduce && <span className="absolute inset-0 animate-ping rounded-full bg-goms-navy/30" aria-hidden />}
                      <span className="relative">{d.getDate()}</span>
                    </span>
                    {list.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-goms-sky sm:hidden" aria-hidden />}
                  </span>
                  <span className="hidden min-h-0 flex-col gap-0.5 sm:flex">
                    {list.slice(0, MAX_CHIPS).map((e) => (
                      <span key={e.id} className={cn('truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-tight transition-transform group-hover:translate-x-0.5', e.allDay ? 'text-white' : 'text-ink-900')}
                        style={e.allDay ? { background: e.color } : { background: `${e.color}1f`, boxShadow: `inset 2px 0 0 ${e.color}` }}>
                        {e.title}
                      </span>
                    ))}
                    {list.length > MAX_CHIPS && <span className="px-1.5 text-[10.5px] font-semibold text-goms-navy">+{list.length - MAX_CHIPS} more</span>}
                  </span>
                </button>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

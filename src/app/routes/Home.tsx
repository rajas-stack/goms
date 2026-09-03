import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import adminRaw from '@/data/india-admin.json'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

interface RawAdminState { st_code: string; st_nm: string; districts: { dt_code: string | null; district: string }[] }
const admin = adminRaw as unknown as RawAdminState[]

/** Org-usage counts loaded lazily (via a dynamic `repository` import) so the
 *  landing page's initial chunk doesn't pull in the whole in-memory data
 *  store just to show two numbers. */
interface LiveCounts {
  offices: number
  employees: number
}

/** Same semantic hierarchy colors as tailwind.config.ts: states=blue,
 *  offices=purple, employees=emerald. Districts gets teal to fill the gap. */
const TONES = {
  blue: { badge: 'bg-blue-100 text-blue-600', bar: 'bg-blue' },
  teal: { badge: 'bg-teal-100 text-teal-600', bar: 'bg-teal' },
  purple: { badge: 'bg-purple-100 text-purple-600', bar: 'bg-purple' },
  emerald: { badge: 'bg-emerald-100 text-emerald-600', bar: 'bg-emerald' },
} as const

/** Edit this list to change which stats the homepage shows, their icon,
 *  color, or order. `value` is `null` until its data is ready, rendered as a
 *  loading dash with an empty bar. */
function useHomeStats() {
  const [live, setLive] = useState<LiveCounts | null>(null)

  useEffect(() => {
    let cancelled = false
    import('@/data/repository').then(async ({ repository }) => {
      const states = await repository.listStates()
      if (cancelled) return
      setLive({
        offices: states.reduce((sum, s) => sum + s.offices, 0),
        employees: states.reduce((sum, s) => sum + s.employees, 0),
      })
    })
    return () => { cancelled = true }
  }, [])

  return [
    { label: 'States & UTs', icon: 'MapPin', tone: 'blue', value: admin.length },
    { label: 'Districts', icon: 'Layers', tone: 'teal', value: admin.reduce((sum, s) => sum + s.districts.length, 0) },
    { label: 'Offices mapped', icon: 'Building', tone: 'purple', value: live?.offices ?? null },
    { label: 'Employees tracked', icon: 'Users', tone: 'emerald', value: live?.employees ?? null },
  ] as const
}

/** The app's true entry point — hero only. AccountMappingRail's single
 *  persistent button (in AppLayout) is the sole way in from here; Home
 *  intentionally carries no other buttons or links. */
export function Home() {
  const stats = useHomeStats()

  // Log scale: states (tens) and employees (thousands) span two orders of
  // magnitude, so a linear bar would leave the smaller stats invisible.
  const maxLog = useMemo(() => {
    const known = stats.map((s) => s.value).filter((v): v is number => v !== null)
    return Math.max(...known.map((v) => Math.log(v + 1)), 1)
  }, [stats])

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto scrollbar-thin px-8 py-12">
      <div className="w-full max-w-2xl">
        <motion.h1
          className="font-display text-[clamp(2.6rem,5vw,4rem)] font-bold leading-[1.03] text-ink-900"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        >
          Every office,<br />mapped to its ground.
        </motion.h1>
        <motion.div
          className="mt-8 grid max-w-xl grid-cols-2 gap-3"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}
        >
          {stats.map((stat, i) => {
            const tone = TONES[stat.tone]
            const pct = stat.value === null ? 0 : (Math.log(stat.value + 1) / maxLog) * 100
            return (
              <motion.div
                key={stat.label}
                className="rounded-card border border-line bg-white p-3.5 shadow-panel"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.16 + i * 0.05 }}
              >
                <div className="flex items-center gap-2.5">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone.badge)}>
                    <Icon name={stat.icon} size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-lg font-bold leading-none text-ink-900">
                      {stat.value === null ? '—' : stat.value.toLocaleString('en-IN')}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted">{stat.label}</div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel">
                  <motion.div
                    className={cn('h-full rounded-full', tone.bar)}
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}

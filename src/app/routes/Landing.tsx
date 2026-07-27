import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { IndiaMap } from '@/features/map/IndiaMap'
import { useStates } from '@/lib/api'

export function Landing() {
  const { data: states = [] } = useStates()
  const totals = useMemo(() => ({
    states: states.length,
    departments: states.reduce((s, x) => s + x.departments, 0),
    offices: states.reduce((s, x) => s + x.offices, 0),
    employees: states.reduce((s, x) => s + x.employees, 0),
  }), [states])

  return (
    <div className="grid h-full grid-cols-1 overflow-y-auto scrollbar-thin lg:grid-cols-[minmax(340px,440px)_1fr] lg:overflow-hidden">
      <section className="flex flex-col justify-center gap-8 border-b border-line px-8 py-12 lg:border-b-0 lg:border-r lg:px-12">
        <div>
          <motion.h1
            className="font-display text-[clamp(2.2rem,4vw,3.4rem)] font-bold leading-[1.02] text-ink-900"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          >
            Every office,<br />mapped to its ground.
          </motion.h1>
          <motion.p
            className="mt-4 max-w-md text-[15px] leading-relaxed text-muted"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}
          >
            A living register of the Government of India — geographic divisions and
            organizational structures held as one dynamic hierarchy. Select a state to
            open its workspace.
          </motion.p>
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Link
            to="/state/0"
            className="group flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3 text-sm font-medium text-ink-900 transition-colors hover:border-ink-600 hover:bg-panel/60"
          >
            Central Ministries (Govt. of India)
            <span aria-hidden className="ml-auto text-muted transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </motion.div>

        <motion.div
          className="grid grid-cols-2 gap-3"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
        >
          <StatCard label="States & UTs" value={totals.states} accent="teal" />
          <StatCard label="Departments" value={totals.departments} accent="ink" />
          <StatCard label="Offices" value={totals.offices} accent="ink" />
          <StatCard label="Employees" value={totals.employees} accent="indigo" />
        </motion.div>
      </section>

      <section className="relative min-h-[420px]">
        <div className="absolute inset-0 p-4 sm:p-8">
          <IndiaMap />
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: 'teal' | 'ink' | 'indigo' }) {
  const ring = { teal: 'text-teal-600', ink: 'text-ink-900', indigo: 'text-indigo-600' }[accent]
  return (
    <div className="rounded-card border border-line bg-white px-4 py-3">
      <div className={`font-mono text-2xl font-semibold tabular-nums ${ring}`}>{value.toLocaleString('en-IN')}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  )
}

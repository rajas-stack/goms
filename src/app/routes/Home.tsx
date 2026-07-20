import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'

/** The app's true entry point — branding + quick actions into the main
 *  sections. The India map (formerly the root page) now lives at `/map`,
 *  reached from here via a quick action rather than being the landing view. */
export function Home() {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto scrollbar-thin px-8 py-12">
      <div className="w-full max-w-2xl">
        <motion.h1
          className="font-display text-[clamp(2.6rem,5vw,4rem)] font-bold leading-[1.03] text-ink-900"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        >
          Every office,<br />mapped to its ground.
        </motion.h1>
        <motion.p
          className="mt-5 max-w-xl text-lg leading-relaxed text-muted"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}
        >
          A living register of the Government of India — geographic divisions and
          organizational structures held as one dynamic hierarchy.
        </motion.p>

        <motion.div
          className="mt-10 space-y-3"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
        >
          <p className="mb-2.5 text-[13px] font-medium uppercase tracking-wide text-muted">Quick actions</p>

          <QuickAction to="/map" icon="Map" tone="teal" title="Account Mapping" description="Browse states and open a workspace" />
        </motion.div>
      </div>
    </div>
  )
}

function QuickAction({ to, icon, tone, title, description }: {
  to: string
  icon: string
  tone: 'teal' | 'indigo'
  title: string
  description: string
}) {
  const toneCls = tone === 'teal' ? 'bg-teal-100 text-teal-600' : 'bg-indigo-100 text-indigo-600'
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-card border border-line bg-white px-5 py-5 transition-colors hover:border-ink-600 hover:bg-panel/60"
    >
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${toneCls}`}>
        <Icon name={icon} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold text-ink-900">{title}</span>
        <span className="block text-sm text-muted">{description}</span>
      </span>
      <Icon name="ChevronRight" size={20} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

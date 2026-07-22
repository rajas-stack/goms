import { NavLink } from 'react-router-dom'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'

/** Icon + label stack shared by every rail entry — icons never appear without
 *  a visible, permanent name (no hover-only reveal). */
function RailContent({ icon, label }: { icon: string; label: string }) {
  return (
    <>
      <Icon name={icon} size={18} />
      <span className="text-[9px] font-medium leading-none tracking-tight">{label}</span>
    </>
  )
}

/** A primary rail destination that reflects its active route. Below `lg:` it
 *  renders as an evenly-spaced bottom-nav tile (row layout, ≥44dp tap
 *  target); from `lg:` up it's the original fixed-width side-rail tile. */
function RailLink({ to, end, icon, label }: { to: string; end?: boolean; icon: string; label: string }) {
  return (
    <NavLink to={to} end={end} title={label} className="flex flex-1 lg:flex-none">
      {({ isActive }) => (
        <div
          className={cn(
            'flex min-h-[44px] w-full flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14 lg:flex-none',
            isActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
          )}
        >
          <RailContent icon={icon} label={label} />
        </div>
      )}
    </NavLink>
  )
}

export function Rail() {
  return (
    <nav
      className={cn(
        // Mobile: fixed bottom-nav bar, out of the flex flow entirely so it
        // overlays the viewport (see AppLayout's `pb-16` content clearance).
        'fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t border-line bg-panel px-1 py-1',
        // Desktop/wide: the original docked side-rail.
        'lg:static lg:w-16 lg:flex-col lg:items-center lg:gap-1.5 lg:border-r lg:border-t-0 lg:px-0 lg:py-4',
      )}
    >
      <RailLink to="/" end icon="Home" label="Home" />
      <RailLink to="/map" icon="Map" label="Map" />
      <RailLink to="/directory" icon="Network" label="Directory" />
      <RailLink to="/analytics" icon="BarChart3" label="Insights" />
    </nav>
  )
}

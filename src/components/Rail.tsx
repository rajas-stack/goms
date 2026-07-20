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

/** A primary rail destination that reflects its active route. */
function RailLink({ to, end, icon, label }: { to: string; end?: boolean; icon: string; label: string }) {
  return (
    <NavLink to={to} end={end} title={label}>
      {({ isActive }) => (
        <div
          className={cn(
            'flex w-14 flex-col items-center gap-1 rounded-xl px-1 py-2 transition-colors',
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
    <nav className="flex w-16 flex-col items-center gap-1.5 border-r border-line bg-panel py-4">
      <RailLink to="/" end icon="Home" label="Home" />
      <RailLink to="/map" icon="Map" label="Map" />
      <RailLink to="/directory" icon="Network" label="Directory" />
      <RailLink to="/analytics" icon="BarChart3" label="Insights" />
    </nav>
  )
}

import { NavLink } from 'react-router-dom'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'

function NavTileContent({ icon, label }: { icon: string; label: string }) {
  return (
    <>
      <Icon name={icon} size={18} className="lg:hidden" />
      <Icon name={icon} size={15} className="hidden lg:inline" />
      <span className="text-[9px] font-medium leading-none tracking-tight lg:text-[13px]">{label}</span>
    </>
  )
}

/** Below `lg:` this renders as an evenly-spaced bottom-nav tile (icon over
 *  label, ≥44dp tap target), matching AccountMappingRail's old bottom-bar
 *  behavior. From `lg:` up it's a horizontal tab (icon beside label). */
function NavTile({ to, end, icon, label }: { to: string; end?: boolean; icon: string; label: string }) {
  return (
    <NavLink to={to} end={end} title={label} className="flex flex-1 lg:flex-none">
      {({ isActive }) => (
        <div
          className={cn(
            'flex min-h-[44px] w-full flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors',
            'lg:h-9 lg:w-auto lg:flex-none lg:flex-row lg:justify-start lg:gap-2 lg:rounded-lg lg:px-3 lg:py-0',
            isActive
              ? 'bg-white text-ink-900 shadow-sm lg:bg-ink-900/[0.06] lg:text-ink-900 lg:shadow-none'
              : 'text-ink-600/70 hover:bg-white hover:text-ink-900 lg:hover:bg-ink-900/[0.05]',
          )}
        >
          <NavTileContent icon={icon} label={label} />
        </div>
      )}
    </NavLink>
  )
}

/** The app's other primary sections — Map/Directory/Insights/Meetings (Home
 *  itself is reached via the Amnex logo, not repeated here). Shown on every
 *  route except Home (AppLayout's `navExpanded`, derived straight from the
 *  URL) so it survives reloads and deep links instead of depending on how
 *  you got there. Renders as a fixed bottom bar below `lg:` and a horizontal
 *  bar directly under TopBar at `lg:` and up. */
export function SecondaryNav() {
  return (
    <nav
      className={cn(
        // `h-14` below `lg`: a fixed, known bar height so overlays that must
        // sit ABOVE it (MobileDetailsSheet's `bottom-14`) line up exactly.
        'fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch gap-1 border-t border-line bg-panel px-1 py-1',
        'lg:static lg:z-auto lg:h-auto lg:justify-start lg:gap-1 lg:border-b lg:border-t-0 lg:bg-paper/70 lg:px-3 lg:py-1.5',
      )}
    >
      <NavTile to="/map" icon="Map" label="Map" />
      <NavTile to="/directory" icon="Network" label="Directory" />
      <NavTile to="/analytics" icon="BarChart3" label="Insights" />
      <NavTile to="/meetings" icon="CalendarClock" label="Meetings" />
      {/* "Sales Team" is the users' own word for this group (the meeting form
          already says "Attending AMNEX Sales Team Members"). Shortened to
          "Sales" below lg, where five flex-1 tiles get ~78px each at 390px. */}
      <NavTile to="/sales" icon="Briefcase" label="Sales Team" />
    </nav>
  )
}

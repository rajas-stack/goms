import { useNavigate } from 'react-router-dom'
import { useShell } from '@/app/AppLayout'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'

/** The app's one persistent navigation element — a slim left rail with a
 *  single "Account Mapping" button. Desktop only (`hidden lg:flex`): on a
 *  phone a permanent vertical rail is a desktop pattern that also ate ~15% of
 *  a 390px viewport, so below `lg` the same entry lives inside
 *  `MobileNavDrawer` (the hamburger menu) instead. Clicking it opens the map;
 *  SecondaryNav's own visibility (Map/Directory/Insights/Meetings) is derived
 *  from the route, not from this click. */
export function AccountMappingRail() {
  const navigate = useNavigate()
  const { navExpanded } = useShell()

  return (
    <nav className="hidden w-14 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-panel py-4 lg:flex lg:w-16">
      <button
        onClick={() => navigate('/map')}
        title="Account Mapping"
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          navExpanded ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="Map" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">Account Mapping</span>
      </button>
    </nav>
  )
}

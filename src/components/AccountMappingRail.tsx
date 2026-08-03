import { useLocation, useNavigate } from 'react-router-dom'
import { useShell } from '@/app/AppLayout'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'

/** The app's persistent navigation element — a slim left rail with one button
 *  per top-level module (Account Mapping, Commercial Calculator — spec §5).
 *  Desktop only (`hidden lg:flex`): on a phone a permanent vertical rail is a
 *  desktop pattern that also ate ~15% of a 390px viewport, so below `lg` the
 *  same entries live inside `MobileNavDrawer` (the hamburger menu) instead.
 *  Account Mapping's active state comes from `navExpanded` (true whenever the
 *  route isn't Home or Commercial Calculator); Commercial Calculator's comes
 *  from the route directly, since `navExpanded` is specifically false there. */
export function AccountMappingRail() {
  const navigate = useNavigate()
  const location = useLocation()
  const { navExpanded } = useShell()
  const commercialActive = location.pathname.startsWith('/commercial-calculator')

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
      <button
        onClick={() => navigate('/commercial-calculator')}
        title="Commercial Calculator"
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          commercialActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="Calculator" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">Commercial Calculator</span>
      </button>
    </nav>
  )
}

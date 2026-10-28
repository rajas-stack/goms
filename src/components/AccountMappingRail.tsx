import { useLocation, useNavigate } from 'react-router-dom'
import { useShell } from '@/app/AppLayout'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'
import { useCanReadAny } from '@/lib/permissions'
import { useNodeFilter } from '@/lib/rbacTree/access'
import { NAV_MODULES } from '@/lib/routeModules'
import { ROUTE_NODES } from '@/app/routeNodes'

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
  const bidTrackerActive = location.pathname.startsWith('/live-bids')
  const teamsActive = location.pathname.startsWith('/teams')
  const documentMakerActive = location.pathname.startsWith('/document-maker')
  const emailActive = location.pathname.startsWith('/email')
  const whatsappActive = location.pathname.startsWith('/whatsapp')
  const marketingActive = location.pathname.startsWith('/marketing')
  // Each entry needs the server policy (A) AND the permission tree. Roles & Access lives in Settings → System settings.
  const tree = useNodeFilter()
  const canAccountMapping = useCanReadAny(NAV_MODULES.accountMapping) && tree('accountMapping')
  const canCommercial = useCanReadAny(NAV_MODULES.commercial) && tree('commercial')
  const canOpportunity = useCanReadAny(NAV_MODULES.opportunity) && tree('opportunity')
  const canTeams = useCanReadAny(NAV_MODULES.teams) && tree('teams')
  const canDirectory = useCanReadAny(NAV_MODULES.directory) && tree(ROUTE_NODES.directory)
  const directoryPath = canDirectory ? '/teams/directory' : '/teams'
  const canDocumentMaker = tree('documentMaker')
  const canEmail = tree('email')
  const canWhatsApp = tree(ROUTE_NODES.whatsapp)
  const canMarketing = tree(ROUTE_NODES.marketing)
  const canInsights = useCanReadAny(NAV_MODULES.insights) && tree('accountMapping.insights')

  return (
    <nav className="hidden w-14 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-panel py-4 lg:flex lg:w-16">
      {canAccountMapping && <button
        onClick={() => navigate('/map')}
        title="Account Mapping"
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          navExpanded ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="Map" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">Account Mapping</span>
      </button>}
      {canCommercial && <button
        onClick={() => navigate('/commercial-calculator')}
        title="Commercial Calculator"
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          commercialActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="Calculator" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">Commercial Calculator</span>
      </button>}
      {isBidTrackerEnabled() && canOpportunity && (
        <button
          onClick={() => navigate('/live-bids')}
          title="Opportunity"
          className={cn(
            'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
            bidTrackerActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
          )}
        >
          <Icon name="Briefcase" size={18} />
          <span className="text-center text-[9px] font-medium leading-tight tracking-tight">Opportunity</span>
        </button>
      )}
      {/* Personal files: open to every signed-in user (the API scopes each file to its owner). */}
      {canDocumentMaker && <button
        onClick={() => navigate('/document-maker')}
        title="Document maker"
        aria-current={documentMakerActive ? 'page' : undefined}
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          documentMakerActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="FilePenLine" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">Document maker</span>
      </button>}
      {canInsights && <button onClick={() => navigate('/insights')} title="Insights" aria-current={/^\/(insights|analytics)/.test(location.pathname) ? 'page' : undefined}
        className={cn('flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 transition-colors lg:w-14', /^\/(insights|analytics)/.test(location.pathname) ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900')}>
        <Icon name="BarChart3" size={18}/><span className="text-center text-[9px] font-medium leading-tight">Insights</span>
      </button>}
      {canEmail && <button
        onClick={() => navigate('/email')}
        title="E-mail"
        aria-current={emailActive ? 'page' : undefined}
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          emailActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="Mail" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">E-mail</span>
      </button>}
      {canWhatsApp && <button
        onClick={() => navigate('/whatsapp')}
        title="WhatsApp"
        aria-current={whatsappActive ? 'page' : undefined}
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          whatsappActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="MessageCircle" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">WhatsApp</span>
      </button>}
      {canMarketing && <button
        onClick={() => navigate('/marketing')}
        title="Marketing"
        aria-current={marketingActive ? 'page' : undefined}
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          marketingActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="Megaphone" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">Marketing</span>
      </button>}
      {/* `mt-auto` pins Teams to the bottom of the rail, apart from the work modules above. */}
      {(canTeams || canDirectory) && <button
        onClick={() => navigate(directoryPath)}
        title="Directory"
        className={cn(
          'flex min-h-[44px] w-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors lg:w-14',
          teamsActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600/70 hover:bg-white hover:text-ink-900',
        )}
      >
        <Icon name="Users" size={18} />
        <span className="text-center text-[9px] font-medium leading-tight tracking-tight">Directory</span>
      </button>}
    </nav>
  )
}

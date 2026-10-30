import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useShell } from '@/app/AppLayout'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'
import { useCanReadAny } from '@/lib/permissions'
import { useNodeFilter } from '@/lib/rbacTree/access'
import { NAV_MODULES } from '@/lib/routeModules'
import { ROUTE_NODES } from '@/app/routeNodes'
import { SPRING_OVERLAY } from '@/lib/motion'

interface Props {
  open: boolean
  onClose: () => void
}

/** Mobile-only hamburger drawer, triggered from TopBar's menu button. It hosts
 *  the "Account Mapping" entry that `AccountMappingRail` renders as a left rail
 *  on desktop — below `lg` that rail is hidden, so this is its mobile home.
 *  Search and Import deliberately DON'T appear here: both already have their
 *  own always-visible controls in TopBar at every viewport, and duplicating
 *  them in the drawer just gave the same action two homes. */
export function MobileNavDrawer({ open, onClose }: Props) {
  const { navExpanded } = useShell()
  const navigate = useNavigate()
  const location = useLocation()
  const commercialActive = location.pathname.startsWith('/commercial-calculator')
  const bidTrackerActive = location.pathname.startsWith('/live-bids')
  const teamsActive = location.pathname.startsWith('/teams')
  const documentMakerActive = location.pathname.startsWith('/document-maker')
  const emailActive = location.pathname.startsWith('/email')
  const whatsappActive = location.pathname.startsWith('/whatsapp')
  const marketingActive = location.pathname.startsWith('/marketing')
  const financeActive = location.pathname.startsWith('/finance')
  const calendarActive = location.pathname.startsWith('/calendar')
  // Same rule as the desktop rail: the server policy (A) AND the permission tree. Roles & Access lives in Settings.
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
  const canFinance = tree(ROUTE_NODES.finance)
  const canCalendar = tree(ROUTE_NODES.calendar)
  const canInsights = useCanReadAny(NAV_MODULES.insights) && tree('accountMapping.insights')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    // Always mounted (see ui/Dialog.tsx for why) so pointer-events tracks
    // the live `open` value instead of lingering through the exit fade.
    <div
      data-canvas-ui
      className={cn('fixed inset-0 z-50 lg:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')}
    >
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 bg-scrim/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="fixed inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col gap-1 border-r border-line bg-paper p-3 shadow-pop"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={SPRING_OVERLAY}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="font-display text-sm font-semibold text-ink-900">Menu</span>
                <button
                  onClick={onClose}
                  aria-label="Close menu"
                  className="flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-ink-900/[0.06] hover:text-ink"
                >
                  <Icon name="X" size={18} />
                </button>
              </div>
              {canAccountMapping && <button
                onClick={() => {
                  onClose()
                  navigate('/map')
                }}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  navExpanded
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="Map" size={17} />
                Account Mapping
              </button>}
              {canCommercial && <button
                onClick={() => {
                  onClose()
                  navigate('/commercial-calculator')
                }}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  commercialActive
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="Calculator" size={17} />
                Commercial Calculator
              </button>}
              {isBidTrackerEnabled() && canOpportunity && (
                <button
                  onClick={() => {
                    onClose()
                    navigate('/live-bids')
                  }}
                  className={cn(
                    'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                    bidTrackerActive
                      ? 'bg-white text-ink-900 shadow-sm'
                      : 'text-ink hover:bg-ink-900/[0.05]',
                  )}
                >
                  <Icon name="Briefcase" size={17} />
                  Opportunity
                </button>
              )}
              {canDocumentMaker && <button
                onClick={() => {
                  onClose()
                  navigate('/document-maker')
                }}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  documentMakerActive
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="FilePenLine" size={17} />
                Document maker
              </button>}
              {canEmail && <button
                onClick={() => {
                  onClose()
                  navigate('/email')
                }}
                aria-current={emailActive ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  emailActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="Mail" size={17} />
                E-mail
              </button>}
              {canWhatsApp && <button
                onClick={() => {
                  onClose()
                  navigate('/whatsapp')
                }}
                aria-current={whatsappActive ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  whatsappActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="MessageCircle" size={17} />
                WhatsApp
              </button>}
              {canMarketing && <button
                onClick={() => {
                  onClose()
                  navigate('/marketing')
                }}
                aria-current={marketingActive ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  marketingActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="Megaphone" size={17} />
                Marketing
              </button>}
              {canFinance && <button
                onClick={() => {
                  onClose()
                  navigate('/finance')
                }}
                aria-current={financeActive ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  financeActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="Wallet" size={17} />
                Finance
              </button>}
              {canCalendar && <button
                onClick={() => {
                  onClose()
                  navigate('/calendar')
                }}
                aria-current={calendarActive ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  calendarActive ? 'bg-white text-ink-900 shadow-sm' : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="CalendarDays" size={17} />
                Calendar
              </button>}
              {canInsights && <button onClick={() => { onClose(); navigate('/insights') }} aria-current={/^\/(insights|analytics)/.test(location.pathname) ? 'page' : undefined} className="flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink hover:bg-ink-900/[0.05]">
                <Icon name="BarChart3" size={17}/>Insights
              </button>}
              {(canTeams || canDirectory) && <button
                onClick={() => {
                  onClose()
                  navigate(directoryPath)
                }}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  teamsActive
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="Users" size={17} />
                Directory
              </button>}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

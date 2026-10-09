import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useShell } from '@/app/AppLayout'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'
import { useShowAccessNav } from '@/lib/accessNav'
import { useCanReadAny } from '@/lib/permissions'
import { NAV_MODULES } from '@/lib/routeModules'

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
  const bidTrackerActive = location.pathname.startsWith('/bid-tracker')
  const teamsActive = location.pathname.startsWith('/teams')
  const accessActive = location.pathname.startsWith('/admin/access')
  // Same rule as the desktop rail (useShowAccessNav). Link visibility is NOT authorization: the route guard and the server decide.
  const canAccess = useShowAccessNav()
  const canAccountMapping = useCanReadAny(NAV_MODULES.accountMapping)
  const canCommercial = useCanReadAny(NAV_MODULES.commercial)
  const canOpportunity = useCanReadAny(NAV_MODULES.opportunity)
  const canTeams = useCanReadAny(NAV_MODULES.teams)

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
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
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
                    navigate('/bid-tracker')
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
              {canAccess && <button
                onClick={() => {
                  onClose()
                  navigate('/admin/access')
                }}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  accessActive
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="Lock" size={17} />
                Role &amp; Access
              </button>}
              {canTeams && <button
                onClick={() => {
                  onClose()
                  navigate('/teams')
                }}
                className={cn(
                  'mt-auto flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium',
                  teamsActive
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink hover:bg-ink-900/[0.05]',
                )}
              >
                <Icon name="Users" size={17} />
                Teams
              </button>}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

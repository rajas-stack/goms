import { Link, useLocation } from 'react-router-dom'
import { useShell } from '@/app/AppLayout'
import { Icon } from './ui/Icon'
import { Button } from './ui/Button'
import { Tooltip } from './ui/Tooltip'
import { AuthStatus } from './AuthStatus'
import { cn } from '@/lib/utils'
import logo from '@/assets/amnex-logo.svg'

interface Props {
  /** Opens the mobile hamburger drawer (Search/Import). Only rendered/used below `lg:`. */
  onOpenDrawer: () => void
}

export function TopBar({ onOpenDrawer }: Props) {
  const { openSearch, openImport, openExport } = useShell()
  const location = useLocation()
  const isHome = location.pathname === '/'
  const isCommercialCalculator = location.pathname.startsWith('/commercial-calculator')
  const isBidTracker = location.pathname.startsWith('/bid-tracker')
  const moduleLabel = isCommercialCalculator ? 'Commercial Calculator' : isBidTracker ? 'Bid Tracker' : 'Accounts Mapping'
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-paper/90 px-3 sm:gap-3 sm:px-5">
      <button
        onClick={onOpenDrawer}
        aria-label="Open menu"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-600 hover:bg-panel lg:hidden"
      >
        <Icon name="Menu" size={20} />
      </button>
      <Link to="/" aria-label="Amnex home" className="shrink-0">
        <img src={logo} alt="Amnex" className="h-8 w-auto" />
      </Link>
      {!isHome && (
        <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
          <span className="h-4 w-px bg-line" />
          <span className="truncate font-display text-[15px] font-semibold text-ink-900">
            {moduleLabel}
          </span>
        </div>
      )}
      {/* Search/Import/Export operate on Account Mapping's hierarchy data
          (src/features/import) — hidden in Commercial Calculator, same as
          SecondaryNav/GlobalFab (AppLayout.tsx's `navExpanded`). */}
      {!isCommercialCalculator && (
        <>
          <button
            onClick={openSearch}
            className="group ml-auto flex h-11 w-full min-w-0 max-w-[12rem] items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm text-muted transition-colors hover:border-ink-600 lg:h-9"
          >
            <Icon name="Search" size={15} className="shrink-0" />
            <span className="truncate">Search…</span>
            {/* Keyboard hint is desktop-only — there's no ⌘/Ctrl key on a phone,
                and the badge was crowding the mobile top bar. */}
            <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted lg:flex">
              ⌘K
            </kbd>
          </button>

          <Tooltip label="Import records from a file" side="bottom" className="shrink-0">
            <Button variant="primary" size="sm" onClick={openImport} aria-label="Import records" className="h-11 lg:h-8">
              <Icon name="Upload" size={15} />
              <span className="hidden sm:inline">Import</span>
            </Button>
          </Tooltip>

          <Tooltip label="Export departments, people, or meetings as CSV" side="bottom" className="shrink-0">
            <Button size="sm" onClick={openExport} aria-label="Export records" className="h-11 lg:h-8">
              <Icon name="Download" size={15} />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </Tooltip>
        </>
      )}

      <div className={cn('flex shrink-0 items-center gap-2', isCommercialCalculator && 'ml-auto')}>
        <AuthStatus />
      </div>
    </header>
  )
}

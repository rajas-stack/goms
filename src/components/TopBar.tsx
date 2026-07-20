import { Link, useLocation } from 'react-router-dom'
import { useShell } from '@/app/AppLayout'
import { Icon } from './ui/Icon'
import { Button } from './ui/Button'
import { Tooltip } from './ui/Tooltip'
import logo from '@/assets/amnex-logo.svg'

export function TopBar() {
  const { openSearch, openImport } = useShell()
  const isHome = useLocation().pathname === '/'
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-paper/90 px-5 backdrop-blur">
      <Link to="/" aria-label="Amnex home" className="shrink-0">
        <img src={logo} alt="Amnex" className="h-8 w-auto" />
      </Link>
      {!isHome && (
        <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
          <span className="h-4 w-px bg-line" />
          <span className="truncate font-display text-[15px] font-semibold text-ink-900">
            Accounts Mapping
          </span>
        </div>
      )}

      <button
        onClick={openSearch}
        className="group ml-auto flex h-9 w-full max-w-[12rem] items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm text-muted transition-colors hover:border-ink-600"
      >
        <Icon name="Search" size={15} />
        <span className="truncate">Search…</span>
        <kbd className="ml-auto flex items-center gap-0.5 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted">
          ⌘K
        </kbd>
      </button>

      <Tooltip label="Import records from a file" side="bottom" className="shrink-0">
        <Button variant="primary" size="sm" onClick={openImport} aria-label="Import records">
          <Icon name="Upload" size={15} />
          <span className="hidden sm:inline">Import</span>
        </Button>
      </Tooltip>
    </header>
  )
}

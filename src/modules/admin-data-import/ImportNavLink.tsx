import { createContext, useContext, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type ImportNavTarget = 'dashboard' | 'session' | 'geography'

const TARGET_PATH: Record<ImportNavTarget, string> = {
  dashboard: '/admin/data-import',
  session: '/admin/data-import/session',
  geography: '/admin/data-import/geography',
}

// Set only inside AdminImportModal, to swap every cross-navigation link
// (AdminImportDashboard/SessionImportWizard/GeographyLoadPanel's "Start
// Import Session"/"Back to Data Import"/geography link) for local step
// state instead of a real `<Link>`. A real `<Link>` needs its own Router
// context, and nesting a second one (a MemoryRouter) inside the app's
// existing RouterProvider tree throws ("You cannot render a <Router>
// inside another <Router>") the moment that subtree actually mounts —
// confirmed live 2026-09-04 (only reachable once authorized, which none of
// this session's automated signed-out checks exercised). Outside the
// modal (the real /admin/data-import* routes), no provider is set, so this
// renders a normal `<Link>` — unchanged from before.
const ImportNavOverrideCtx = createContext<((target: ImportNavTarget) => void) | null>(null)
export const ImportNavProvider = ImportNavOverrideCtx.Provider

export function ImportNavLink({ to, className, children }: { to: ImportNavTarget; className?: string; children: ReactNode }) {
  const override = useContext(ImportNavOverrideCtx)
  if (override) {
    return (
      <button type="button" onClick={() => override(to)} className={className}>
        {children}
      </button>
    )
  }
  return (
    <Link to={TARGET_PATH[to]} className={className}>
      {children}
    </Link>
  )
}

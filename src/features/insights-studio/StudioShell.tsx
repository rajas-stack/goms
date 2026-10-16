import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { STUDIO_PATHS } from './paths'
import './studio.css'

const LINKS = [
  { to: STUDIO_PATHS.visuals, label: 'Visualization components' },
  { to: STUDIO_PATHS.reports, label: 'Templates / Reports' },
  { to: STUDIO_PATHS.dataSources, label: 'Data sources' },
] as const

/** Page frame shared by every Insights Studio screen. */
export function StudioShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="studio" data-testid="insights-studio">
      <header className="studio-header">
        <Link to={STUDIO_PATHS.insights} className="studio-icon-btn" aria-label="Back to Insights" title="Back to Insights"><Icon name="ArrowLeft" /></Link>
        <h1>{title}</h1>
        <nav className="studio-nav" aria-label="Insights studio">
          {LINKS.map((l) => <NavLink key={l.to} to={l.to}>{l.label}</NavLink>)}
        </nav>
        {actions}
      </header>
      <main className="studio-body">{children}</main>
    </div>
  )
}

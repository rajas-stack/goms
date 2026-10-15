import { Icon } from '@/components/ui/Icon'
import { OrgEmployees } from '@/features/org/OrgEmployees'
import { AmnexDepartmentsSection } from '@/features/departments/AmnexDepartmentsSection'
import { Link } from 'react-router-dom'
import '@/components/theme/SettingsMenu.css'

/** Settings > Masters > Employee Master: the employee grid, with the Amnex departments reference list kept above it. */
export function SettingsEmployeeMasterPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-line bg-paper/70 px-4 py-3 sm:px-6">
        <Link to="/settings" className="settings-back mb-2 focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Settings</Link>
        <h1 className="text-xl font-semibold text-ink-900">Employee Master</h1>
        <p className="mt-1 text-[13px] text-muted">Manage employees, reporting lines, departments, and status.</p>
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-900">Amnex departments</summary>
          <div className="max-h-72 overflow-y-auto"><AmnexDepartmentsSection /></div>
        </details>
      </header>
      <div className="min-h-0 flex-1"><OrgEmployees /></div>
    </div>
  )
}

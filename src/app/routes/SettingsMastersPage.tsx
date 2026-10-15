import { Icon } from '@/components/ui/Icon'
import { SettingsIcon } from '@/components/theme/SettingsIcon'
import { Link } from 'react-router-dom'

export function SettingsMastersPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/settings" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Back to Settings</Link>
        <h1 className="text-2xl font-semibold text-ink-900">Masters</h1>
        <p className="mb-6 mt-1 text-[13px] text-muted">Manage workspace reference data.</p>
        <Link to="/settings/masters/employee-master" className="group flex items-center gap-4 rounded-2xl border border-line bg-white p-4 text-ink transition-colors hover:border-ink-600/30 hover:bg-panel focus-visible:focus-ring sm:p-5">
          <SettingsIcon kind="masters" />
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-ink-900">Employee Master</span><span className="mt-1 block text-xs text-muted">Manage employees, reporting lines, departments, and status.</span></span>
          <Icon name="ChevronRight" size={18} className="text-muted transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  )
}

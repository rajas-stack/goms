import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { AmnexDepartmentsSection } from '@/features/departments/AmnexDepartmentsSection'
import '@/components/theme/SettingsMenu.css'

/** Settings > Masters > Employee Master: reference lists for employees (currently the Amnex Departments). */
export function EmployeeMasterSettingsPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/settings" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Settings</Link>
        <h1 className="mt-1 font-display text-xl font-semibold text-ink-900">Employee Master</h1>
        <AmnexDepartmentsSection />
      </div>
    </div>
  )
}

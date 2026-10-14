import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { CompetitorsSection } from '@/features/competitors/CompetitorsSection'
import '@/components/theme/SettingsMenu.css'

/** Settings > Pre-sales > Competitors: rival companies, their positioning and capabilities. Wider than the other
 *  settings pages because the list is a multi-column table on desktop. */
export function CompetitorsSettingsPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/settings" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Settings</Link>
        <CompetitorsSection />
      </div>
    </div>
  )
}

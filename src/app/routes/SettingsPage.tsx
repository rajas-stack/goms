import { SettingsMenu } from '@/components/theme/SettingsDialog'
import { Icon } from '@/components/ui/Icon'
import { Link } from 'react-router-dom'

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Back to workspace</Link>
        <h1 className="text-2xl font-semibold text-ink-900">Settings</h1>
        <p className="mb-6 mt-1 text-[13px] text-muted">Configure your workspace.</p>
        <SettingsMenu />
      </div>
    </div>
  )
}

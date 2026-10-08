import { SettingsMenu } from '@/components/theme/SettingsDialog'

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-semibold text-ink-900">Settings</h1>
        <p className="mb-6 mt-1 text-[13px] text-muted">Configure your workspace.</p>
        <SettingsMenu />
      </div>
    </div>
  )
}

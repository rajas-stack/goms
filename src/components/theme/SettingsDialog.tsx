import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { Link } from 'react-router-dom'
import { WEBSITE_KIND_COPY, type WebsiteKindCopy } from '@/features/tender-websites/websiteKinds'
import { SettingsIcon, type SettingsIconKind } from './SettingsIcon'
import './SettingsMenu.css'

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Settings" description="Configure your workspace." size="lg">
      <button type="button" onClick={onClose} className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Back to workspace</button>
      <SettingsMenu onNavigate={onClose} />
    </Dialog>
  )
}

const websitePage = ({ route, title, hint }: WebsiteKindCopy, kind: SettingsIconKind) => ({ to: route, kind, title, hint })

const SETTINGS_PAGES = [
  { to: '/settings/credentials', kind: 'credentials' as const, title: 'Credentials', hint: 'Manage shared passphrases.' },
  { to: '/settings/dms', kind: 'storage' as const, title: 'DMS Settings', hint: 'Connect Drive and organize documents.' },
  websitePage(WEBSITE_KIND_COPY.tender, 'tender'),
  websitePage(WEBSITE_KIND_COPY.verification, 'verification'),
]

export function SettingsMenu({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {SETTINGS_PAGES.map(page => (
        <Link key={page.to} to={page.to} onClick={onNavigate} className="group flex items-center gap-4 rounded-2xl border border-line bg-white p-4 text-ink transition-colors hover:border-ink-600/30 hover:bg-panel focus-visible:focus-ring sm:p-5">
          <SettingsIcon kind={page.kind} />
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-ink-900">{page.title}</span><span className="mt-1 block text-xs text-muted">{page.hint}</span></span>
          <Icon name="ChevronRight" size={18} className="text-muted transition-transform group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-line border-b-2 bg-panel px-1.5 font-mono text-[10.5px] font-medium text-ink-700">{children}</kbd>
}

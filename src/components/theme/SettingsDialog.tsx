import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { Link } from 'react-router-dom'
import { WEBSITE_KIND_COPY, type WebsiteKindCopy } from '@/features/tender-websites/websiteKinds'

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Settings" description="Configure your workspace." size="lg">
      <SettingsMenu onNavigate={onClose} />
    </Dialog>
  )
}

const websitePage = ({ route, icon, title, hint }: WebsiteKindCopy) => ({ to: route, icon, title, hint })

const SETTINGS_PAGES = [
  { to: '/settings/dms', icon: 'FileText', title: 'DMS Settings', hint: 'Document storage, Google Drive, and provider setup' },
  websitePage(WEBSITE_KIND_COPY.tender),
  websitePage(WEBSITE_KIND_COPY.verification),
]

export function SettingsMenu({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {SETTINGS_PAGES.map(page => (
        <Link key={page.to} to={page.to} onClick={onNavigate} className="group flex items-center gap-3 rounded-xl border border-line bg-white p-4 text-ink transition-colors hover:border-indigo/40 hover:bg-panel focus-visible:focus-ring">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo"><Icon name={page.icon} size={20} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink-900">{page.title}</span><span className="mt-1 block text-xs text-muted">{page.hint}</span></span>
          <Icon name="ChevronRight" size={18} className="text-muted transition-transform group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-line border-b-2 bg-panel px-1.5 font-mono text-[10.5px] font-medium text-ink-700">{children}</kbd>
}

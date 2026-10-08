import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { TenderWebsiteKind } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { TenderWebsitesSection } from '@/features/tender-websites/TenderWebsitesSection'
import { WEBSITE_KIND_COPY } from '@/features/tender-websites/websiteKinds'

/** A Settings page listing one kind of saved website. */
function WebsitesSettingsPage({ kind }: { kind: TenderWebsiteKind }) {
  const copy = WEBSITE_KIND_COPY[kind]
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/settings" className="mb-5 inline-flex items-center gap-1.5 rounded text-[13px] text-muted hover:text-ink focus-visible:focus-ring"><ArrowLeft size={15} />Settings</Link>
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel text-ink-700"><Icon name={copy.icon} size={23} /></span>
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">{copy.title}</h1>
            <p className="mt-1 text-[13px] text-muted">{copy.description}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-4 sm:p-6"><TenderWebsitesSection kind={kind} /></div>
      </div>
    </div>
  )
}

export function TenderWebsitesSettingsPage() {
  return <WebsitesSettingsPage kind="tender" />
}

export function DocumentVerificationsSettingsPage() {
  return <WebsitesSettingsPage kind="verification" />
}

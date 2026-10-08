import { Link } from 'react-router-dom'
import { ArrowLeft, Globe } from 'lucide-react'
import { TenderWebsitesSection } from '@/features/tender-websites/TenderWebsitesSection'

export function TenderWebsitesSettingsPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/settings" className="mb-5 inline-flex items-center gap-1.5 rounded text-[13px] text-muted hover:text-ink focus-visible:focus-ring"><ArrowLeft size={15} />Settings</Link>
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel text-ink-700"><Globe size={23} /></span>
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">Tender websites</h1>
            <p className="mt-1 text-[13px] text-muted">Portals for downloading bidding documents, corrigenda and addenda. They appear as links in a bid's General tab.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-4 sm:p-6"><TenderWebsitesSection /></div>
      </div>
    </div>
  )
}

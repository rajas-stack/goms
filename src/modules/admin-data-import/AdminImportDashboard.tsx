import { AdminImportBanner } from './AdminImportBanner'
import { useAdminImportDomains, type DomainListEntry, type SpreadsheetDomainKey } from './api'
import { downloadTemplate } from './templates'
import { ImportNavLink } from './ImportNavLink'
import { Icon } from '@/components/ui/Icon'

function StatusPill({ status, labelByDomain }: { status: DomainListEntry['dependencyStatus']; labelByDomain: Map<string, string> }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[12px] font-medium text-emerald-600">
        <Icon name="Check" size={12} /> Ready
      </span>
    )
  }
  const names = status.blockedOn.map((d) => labelByDomain.get(d) ?? d).join(', ')
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-medium text-amber-600">
      Blocked on {names}
    </span>
  )
}

function ActionsCell({ domain }: { domain: DomainListEntry['domain'] }) {
  if (domain === 'geography') {
    return (
      <ImportNavLink to="geography" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo hover:underline">
        <Icon name="MapPin" size={13} /> Load/Update Official Geography Dataset
      </ImportNavLink>
    )
  }
  return (
    <button
      type="button"
      onClick={() => downloadTemplate(domain as SpreadsheetDomainKey)}
      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo hover:underline"
    >
      <Icon name="Download" size={13} /> Download Template
    </button>
  )
}

export function AdminImportDashboard() {
  const { data: domains, isLoading } = useAdminImportDomains()
  const labelByDomain = new Map((domains ?? []).map((d) => [d.domain, d.label]))

  return (
    <div className="space-y-4 p-6">
      <AdminImportBanner />

      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-lg font-bold text-ink-900">Admin Data Import</h1>
        <ImportNavLink
          to="session"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3.5 text-[13px] font-medium text-paper shadow-sm transition-all duration-150 hover:bg-ink-800 active:scale-[0.98]"
        >
          <Icon name="Upload" size={14} /> Start Import Session
        </ImportNavLink>
      </div>

      {isLoading || !domains ? (
        <p className="text-[13px] text-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-panel/60 text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">Current Rows</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.domain} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium text-ink-900">{d.label}</td>
                  <td className="px-3 py-2 text-muted">{d.currentRowCount}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={d.dependencyStatus} labelByDomain={labelByDomain} />
                  </td>
                  <td className="px-3 py-2">
                    <ActionsCell domain={d.domain} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

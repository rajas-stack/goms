import { Link } from 'react-router-dom'
import { AdminImportBanner } from './AdminImportBanner'
import { useAdminImportDomains, type DomainListEntry, type SpreadsheetDomainKey } from './api'
import { downloadTemplate } from './templates'

function StatusCell({ status, labelByDomain }: { status: DomainListEntry['dependencyStatus']; labelByDomain: Map<string, string> }) {
  if (status === 'ready') return <span className="text-emerald-700">Ready</span>
  const names = status.blockedOn.map((d) => labelByDomain.get(d) ?? d).join(', ')
  return <span className="text-amber-700">Blocked on {names}</span>
}

function ActionsCell({ domain, status }: { domain: DomainListEntry['domain']; status: DomainListEntry['dependencyStatus'] }) {
  if (domain === 'geography') {
    return (
      <Link to="/admin/data-import/geography" className="text-sky-700 underline">
        Load/Update Official Geography Dataset
      </Link>
    )
  }
  const blocked = status !== 'ready'
  return (
    <div className="flex gap-3">
      <button type="button" onClick={() => downloadTemplate(domain as SpreadsheetDomainKey)} className="text-sky-700 underline">
        Download Template
      </button>
      <Link
        to={`/admin/data-import/${domain}`}
        aria-disabled={blocked}
        className={blocked ? 'pointer-events-none text-slate-400 underline' : 'text-sky-700 underline'}
      >
        Upload & Review
      </Link>
    </div>
  )
}

export function AdminImportDashboard() {
  const { data: domains, isLoading } = useAdminImportDomains()
  const labelByDomain = new Map((domains ?? []).map((d) => [d.domain, d.label]))

  return (
    <div className="space-y-4 p-6">
      <AdminImportBanner />
      <h1 className="text-xl font-semibold">Admin Data Import</h1>
      {isLoading || !domains ? (
        <p>Loading…</p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Domain</th>
              <th className="py-2">Current Rows</th>
              <th className="py-2">Status</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.domain} className="border-b">
                <td className="py-2">{d.label}</td>
                <td className="py-2">{d.currentRowCount}</td>
                <td className="py-2">
                  <StatusCell status={d.dependencyStatus} labelByDomain={labelByDomain} />
                </td>
                <td className="py-2">
                  <ActionsCell domain={d.domain} status={d.dependencyStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

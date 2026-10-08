import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Cloud, ExternalLink, FileText, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { DMS_MODULES, removeConnection, saveConnection, type DmsConnection } from './connections'
import { disconnectDrive, getDriveSession } from './googleDrive'
import { ModulePicker } from './ModulePicker'
import { syncMaster } from './masterSync'
import { useConnections } from './useConnections'

const linkClass = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-panel focus-visible:focus-ring'
export function DmsConnections() {
  const connections = useConnections()
  const toast = useToast()
  const [filter, setFilter] = useState<'all' | 'connected'>('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<DmsConnection | null>(null)
  const master = connections.find((item) => item.isMaster)
  const regular = connections.filter((item) => !item.isMaster && (filter === 'all' || getDriveSession(item.id)))

  function assign(connection: DmsConnection, modules: DmsConnection['modules']) {
    try { saveConnection({ ...connection, modules }); setError(''); toast('DMS places updated.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save places.') }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1 rounded-lg bg-panel p-1"><Button size="sm" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilter('all')}>All DMS</Button><Button size="sm" variant={filter === 'connected' ? 'secondary' : 'ghost'} onClick={() => setFilter('connected')}>Connected</Button></div>
      <Link to="/settings/dms/new" className={linkClass}><Plus size={15} />Create new</Link>
    </div>
    {error && <p role="alert" className="rounded-lg bg-crimson/5 p-3 text-[13px] text-crimson">{error}</p>}
    {regular.length ? <div className="divide-y divide-line rounded-xl border border-line bg-white">{regular.map((connection) => {
      const session = getDriveSession(connection.id)
      return <div key={connection.id} className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-1 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-panel text-indigo">{connection.settings.provider === 'google-drive' ? <Cloud size={20} /> : <ExternalLink size={20} />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink-900">{connection.name}</h3><span className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">{session ? 'Connected' : connection.settings.provider === 'external' ? 'Portal link' : connection.accountEmail ? 'Reconnect' : 'Configured'}</span></div><p className="mt-1 truncate text-xs text-muted">{session?.email ?? connection.accountEmail ?? (connection.settings.provider === 'google-drive' ? 'Google Drive' : connection.settings.externalUrl)}</p><p className="mt-1 text-xs text-muted">{connection.modules.length ? connection.modules.map((id) => DMS_MODULES.find((module) => module.id === id)?.label).join(', ') : 'No places assigned'}</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><ModulePicker value={connection.modules} onChange={(modules) => assign(connection, modules)} /><Link to={`/settings/dms/${connection.id}`} className={linkClass}>{session ? 'Manage' : 'Configure'}</Link><Button size="icon" variant="ghost" aria-label={`Remove ${connection.name}`} onClick={() => setRemove(connection)}><Trash2 size={15} /></Button></div>
      </div>
    })}</div> : <div className="rounded-xl border border-dashed border-line p-10 text-center"><FileText size={28} className="mx-auto mb-3 text-muted" /><h3 className="text-sm font-semibold text-ink">{filter === 'connected' ? 'No active connections' : 'No DMS connections yet'}</h3><p className="mt-1 text-[13px] text-muted">{filter === 'connected' ? 'Open a configured DMS and connect its Google account.' : 'Create a connection, then choose the places it works in.'}</p></div>}
    <section className="space-y-3 rounded-xl border border-indigo/20 bg-indigo-100/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink-900">Master DMS</h3><p className="mt-1 text-xs text-muted">One folder for all DMS documents, grouped by DMS name.</p></div>{master ? <Link className={linkClass} to={`/settings/dms/${master.id}`}>Configure master</Link> : <Link className={linkClass} to="/settings/dms/new?master=true"><Plus size={15} />Add master DMS</Link>}</div>
      {master && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-indigo/15 pt-3"><div><p className="text-sm font-medium text-ink">{master.name}</p><p className="mt-1 text-xs text-muted">{master.lastSyncedAt ? `Last collected: ${new Date(master.lastSyncedAt).toLocaleString()}` : 'Ready to configure document collection'}</p></div><div className="flex gap-2"><Button size="sm" disabled={busy || !getDriveSession(master.id) || !master.settings.rootFolderId} onClick={async () => {
        setBusy(true); setError('')
        try { const result = await syncMaster(master); if (result.errors.length) setError(`Copied ${result.copied} documents. ${result.errors.join(' ')}`); else toast(`${result.copied} copied; ${result.skipped} already current.`) }
        catch (e) { setError(e instanceof Error ? e.message : 'Master collection failed.') }
        finally { setBusy(false) }
      }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}Collect documents</Button><Button size="icon" variant="ghost" disabled={busy} aria-label={`Remove ${master.name}`} onClick={() => setRemove(master)}><Trash2 size={15} /></Button></div></div>}
    </section>
    {remove && <div className="rounded-xl border border-line bg-white p-4"><p className="text-sm font-medium text-ink">Remove {remove.name} from GOMS?</p><p className="mt-1 text-xs text-muted">The files in Google Drive remain available.</p><div className="mt-3 flex justify-end gap-2"><Button size="sm" onClick={() => setRemove(null)}>Cancel</Button><Button size="sm" variant="danger" onClick={() => {
      try { removeConnection(remove.id); disconnectDrive(remove.id); setRemove(null); toast('DMS connection removed.') }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not remove connection.') }
    }}>Remove connection</Button></div></div>}
  </div>
}

import { useEffect, useState } from 'react'
import { CheckCircle2, Cloud, ExternalLink, FolderPlus, Link2, Loader2, Save, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { DocumentLibrary } from './DocumentLibrary'
import { connectDrive, createFolder, disconnectDrive, getDriveSession, getFolder, loadGoogleIdentity, type DriveFile, type DriveSession } from './googleDrive'
import { DEFAULT_DMS_SETTINGS, folderIdFromInput, loadSettings, saveSettings, validateSettings, type DmsSettings } from './settings'
import { loadConnections, saveConnection, type DmsModule } from './connections'
import { ModulePicker } from './ModulePicker'
import { syncMaster } from './masterSync'

export function DmsSetup({ connectionId = 'default', master = false, onSaved }: { connectionId?: string; master?: boolean; onSaved?: (id: string) => void } = {}) {
  const toast = useToast()
  const [record, setRecord] = useState(() => loadConnections().find((item) => item.id === connectionId))
  const isMaster = record?.isMaster ?? master
  const [name, setName] = useState(record?.name ?? (isMaster ? 'Master DMS' : ''))
  const [modules, setModules] = useState<DmsModule[]>(record?.modules ?? [])
  const [saved, setSaved] = useState(() => record?.settings ?? (connectionId === 'default' ? loadSettings() : { ...DEFAULT_DMS_SETTINGS }))
  const [draft, setDraft] = useState(saved)
  const [session, setSession] = useState<DriveSession | null>(() => getDriveSession(connectionId))
  const [root, setRoot] = useState<DriveFile | null>(null)
  const [tab, setTab] = useState<'setup' | 'documents'>('setup')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [identityReady, setIdentityReady] = useState(false)
  const isDrive = draft.provider === 'google-drive'

  useEffect(() => {
    if (!isDrive) return
    let active = true
    loadGoogleIdentity().then(() => { if (active) setIdentityReady(true) }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [isDrive])

  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => {
      disconnectDrive(connectionId); setSession(null); setRoot(null)
      setError('Your Google Drive session has expired. Reconnect to continue.')
    }, Math.max(0, session.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session])

  useEffect(() => {
    let active = true
    setRoot(null)
    if (session && saved.rootFolderId && saved.provider === 'google-drive') {
      getFolder(saved.rootFolderId, connectionId).then((folder) => { if (active) setRoot(folder) }).catch((e) => {
        if (active) {
          setError(e.message)
          if (!getDriveSession(connectionId)) setSession(null)
        }
      })
    }
    return () => { active = false }
  }, [session, saved.rootFolderId, saved.provider])

  function update<K extends keyof DmsSettings>(key: K, value: DmsSettings[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action); setError('')
    try { await work() } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation could not be completed.')
      if (!getDriveSession(connectionId)) { setSession(null); setRoot(null) }
    } finally { setBusy('') }
  }

  function checkName() {
    if (connectionId !== 'default' && (!name.trim() || name.trim().length > 120)) throw new Error('Enter a DMS name between 1 and 120 characters.')
  }

  function persist(settings: DmsSettings, connected?: DriveSession) {
    checkName()
    const valid = validateSettings(settings)
    if (connectionId === 'default') saveSettings(valid)
    else {
      const entry = saveConnection({
        id: connectionId, name, modules, isMaster, settings: valid,
        accountEmail: connected?.email ?? record?.accountEmail,
        lastConnectedAt: connected ? new Date().toISOString() : record?.lastConnectedAt,
        lastSyncedAt: loadConnections().find(item => item.id === connectionId)?.lastSyncedAt,
      })
      setRecord(entry)
    }
    if (!connected && (valid.clientId !== saved.clientId || valid.provider !== saved.provider)) { disconnectDrive(connectionId); setSession(null); setRoot(null) }
    setSaved(valid); setDraft(valid)
    onSaved?.(connectionId)
    return valid
  }

  function save() {
    setError('')
    try { persist(draft); toast('DMS setup saved on this device.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Settings could not be saved.') }
  }

  function connect() {
    try {
      checkName()
      const settings = validateSettings(draft)
      if (!settings.clientId) throw new Error('Enter your Google OAuth client ID first.')
      // Start the popup in the click handler before awaiting anything.
      const connection = connectDrive(settings.clientId, connectionId)
      void run('connect', async () => {
        const connected = await connection
        persist(settings, connected)
        setSession(connected)
        toast(`Google Drive connected: ${connected.email}`)
      })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect.') }
  }

  const dirty = (connectionId !== 'default' && !record) || name !== (record?.name ?? (isMaster ? 'Master DMS' : '')) || JSON.stringify(modules) !== JSON.stringify(record?.modules ?? []) || JSON.stringify(saved) !== JSON.stringify(draft)

  return (
    <div className="space-y-5">
      {connectionId !== 'default' && <div className="grid items-end gap-4 sm:grid-cols-2">
        <Field label="DMS name" required><Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="e.g. Sales documents" disabled={!!busy} /></Field>
        {!isMaster && <div><p className="mb-1.5 text-[13px] font-medium text-ink-800">Where this DMS works</p><ModulePicker value={modules} onChange={setModules} disabled={!!busy} /><p className="mt-1 text-xs text-muted">Each place uses one DMS. Selecting a place moves its assignment here.</p></div>}
      </div>}
      {isMaster && <p className="rounded-lg border border-indigo/20 bg-indigo-100/30 p-3 text-[13px] text-ink">Master DMS collects copies from your other Google Drive connections into subfolders named after each DMS. Share their source folders with the master Google account.</p>}
      <Field label="Storage provider"><Select value={draft.provider} disabled={!!busy || isMaster} onChange={(e) => { update('provider', e.target.value as DmsSettings['provider']); setTab('setup'); setError('') }}><option value="google-drive">Google Drive</option>{!isMaster && <option value="external">External DMS (portal link)</option>}</Select></Field>
      {isDrive && <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo"><Cloud size={23} /></span>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-ink-900">Google Drive</h3><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', session ? 'bg-emerald-100 text-emerald-700' : 'bg-panel text-muted')}>{session ? 'Connected' : 'Not connected'}</span></div>
              <p className="mt-1 truncate text-xs text-muted">{session ? session.email : 'Document storage and version history'}</p>
            </div>
          </div>
          {session ? <Button size="sm" disabled={!!busy} onClick={() => { disconnectDrive(connectionId); setSession(null); setRoot(null); setError('') }}><Unplug size={14} />Disconnect</Button> :
            <Button variant="primary" size="sm" disabled={!!busy || !identityReady} onClick={connect}>{busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}Connect Google Drive</Button>}
        </div>
        <div role="tablist" aria-label="DMS" className="flex gap-1 border-b border-line">
          {(['setup', 'documents'] as const).map((value) => <button key={value} id={`dms-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`dms-panel-${value}`} onClick={() => setTab(value)} className={cn('border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors focus-visible:focus-ring', tab === value ? 'border-indigo text-indigo' : 'border-transparent text-muted hover:text-ink')}>{value === 'setup' ? 'Configuration' : 'Documents'}</button>)}
        </div>
      </>}
      {error && <div role="alert" className="rounded-lg border border-crimson/20 bg-crimson/5 px-3 py-2.5 text-[13px] text-crimson">{error}{isDrive && !identityReady && <button className="ml-2 underline" onClick={() => { setError(''); void loadGoogleIdentity().then(() => setIdentityReady(true)).catch((e) => setError(e.message)) }}>Retry sign-in</button>}</div>}
      {!isDrive ? <div className="space-y-4">
        <Field label="External DMS URL" hint="Open your existing document portal. Files and sign-in are managed by that provider."><Input type="url" value={draft.externalUrl} onChange={(e) => update('externalUrl', e.target.value)} placeholder="https://documents.your-company.com" /></Field>
        <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!dirty} onClick={save}><Save size={15} />Save setup</Button>{saved.provider === 'external' && <a className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-panel" href={saved.externalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open DMS</a>}</div>
        <p className="text-xs text-muted">Configuration is saved on this device.</p>
      </div> : tab === 'setup' ? (
        <div role="tabpanel" id="dms-panel-setup" aria-labelledby="dms-tab-setup" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Google OAuth client ID" hint="Web application client ID from your Google Cloud project. Enable the Google Drive API and add this site's origin to Authorized JavaScript origins."><Input value={draft.clientId} placeholder="123456789-example.apps.googleusercontent.com" onChange={(e) => update('clientId', e.target.value)} disabled={!!busy} autoComplete="off" /></Field></div>
            <div className="sm:col-span-2"><Field label="Root folder URL or ID" hint="An existing My Drive or shared-drive folder. Documents retain its Google Drive permissions."><Input value={draft.rootFolderId} placeholder="https://drive.google.com/drive/folders/…" onChange={(e) => update('rootFolderId', e.target.value)} disabled={!!busy} /></Field></div>
            <Field label="Maximum file size (MB)"><Input type="number" min={1} step={1} value={draft.maxUploadMb ?? ''} placeholder="No limit" onChange={(e) => update('maxUploadMb', e.target.value === '' ? null : Number(e.target.value))} disabled={!!busy} /><span className="mt-1 block text-xs text-muted">Leave blank for no app upload limit.</span></Field>
            <Field label="Allowed uploads"><Select value={draft.allowedFiles} onChange={(e) => update('allowedFiles', e.target.value as DmsSettings['allowedFiles'])} disabled={!!busy}><option value="documents">Documents and images</option><option value="pdf">PDF only</option><option value="all">All file types</option></Select></Field>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-white p-3">
            <span><span className="block text-[13px] font-medium text-ink">Automatically refresh documents</span><span className="block text-xs text-muted">Check for Drive changes every minute while the library is open.</span></span>
            <input type="checkbox" checked={draft.autoRefresh} onChange={(e) => update('autoRefresh', e.target.checked)} className="h-4 w-4 shrink-0 accent-indigo" disabled={!!busy} />
          </label>
          {root && <div className="flex items-center gap-2 rounded-lg bg-emerald-100/60 p-3 text-[13px] text-emerald-700"><CheckCircle2 size={16} /><span>Folder verified: <strong>{root.name}</strong></span></div>}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button variant="primary" disabled={!!busy || !dirty} onClick={save}><Save size={15} />Save setup</Button>
            <Button disabled={!!busy || !session || !draft.rootFolderId.trim() || draft.clientId.trim() !== saved.clientId} onClick={() => void run('test', async () => {
              const valid = validateSettings(draft)
              const id = folderIdFromInput(valid.rootFolderId)
              checkName()
              const folder = await getFolder(id, connectionId)
              persist({ ...valid, rootFolderId: id }); setRoot(folder)
              toast(`Connection verified: ${folder.name}`)
            })}>{busy === 'test' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Verify folder</Button>
            <Button disabled={!!busy || !session || !!draft.rootFolderId.trim() || draft.clientId.trim() !== saved.clientId} onClick={() => void run('create', async () => {
              const valid = validateSettings(draft)
              checkName()
              const folder = await createFolder(name.trim() || 'GOMS Documents', undefined, connectionId)
              persist({ ...valid, rootFolderId: folder.id }); setRoot(folder)
              toast('GOMS Documents folder created in Google Drive.')
            })}>{busy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <FolderPlus size={15} />}Create root folder</Button>
          </div>
          {isMaster && <Button disabled={!!busy || !session || !root || !record} onClick={() => void run('sync', async () => {
            const result = await syncMaster(record!)
            if (result.errors.length) setError(`Copied ${result.copied} document(s). ${result.errors.join(' ')}`)
            else toast(`Master DMS: ${result.copied} copied, ${result.skipped} already current.`)
          })}>{busy === 'sync' ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}Collect documents into master</Button>}
          <p className="text-xs text-muted">Configuration is saved on this device. Google permissions apply to every document.</p>
        </div>
      ) : (
        <div role="tabpanel" id="dms-panel-documents" aria-labelledby="dms-tab-documents">
          {session && root ? <DocumentLibrary key={root.id} root={root} settings={saved} connectionId={connectionId} onSessionExpired={() => { setSession(null); setRoot(null); setError('Your Google Drive session has expired. Reconnect to continue.') }} /> : <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center"><Cloud size={32} className="mb-3 text-muted" /><h4 className="text-sm font-semibold text-ink">{session ? 'Choose a document folder' : 'Connect your Google Drive'}</h4><p className="mt-1 max-w-sm text-[13px] text-muted">{session ? 'Verify an existing folder or create a GOMS Documents folder in Configuration.' : 'Connect Google Drive and select a root folder to manage your documents.'}</p><Button size="sm" className="mt-4" onClick={() => setTab('setup')}>Go to configuration</Button></div>}
        </div>
      )}
    </div>
  )
}

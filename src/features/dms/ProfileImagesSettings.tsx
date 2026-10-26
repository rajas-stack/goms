import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Folder } from 'lucide-react'
import { useAuthUser } from '@/lib/auth'
import { useNodeAccess } from '@/lib/rbacTree'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { folderIdFromInput } from './settings'
import { notifyProfileImages, PROFILE_IMAGES_QUERY, profileImagesApi } from './profileImagesClient'
import { DriveProfileImagesSettings } from './DriveProfileImagesSettings'

type FolderLocation = { id: string; name: string }
const MY_DRIVE: FolderLocation = { id: 'root', name: 'My Drive' }

export function ProfileImagesSettings() {
  return <section className="mt-6 space-y-4 rounded-xl border border-line bg-white p-4 sm:p-6" aria-labelledby="profile-images-title">
    <div><h2 id="profile-images-title" className="text-base font-semibold text-ink-900">Profile Images</h2><p className="mt-1 text-[13px] text-muted">Employee photos from your private Google Drive folder. Choose a folder, then sync to update photos across Employees and Sales.</p></div>
    {import.meta.env.VITE_API_BASE_URL ? <ConnectedProfileImagesSettings /> : <DriveProfileImagesSettings />}
  </section>
}
function ConnectedProfileImagesSettings() {
  const { user } = useAuthUser(); const canEdit = useNodeAccess('settings.system.storage', 'edit')
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: [...PROFILE_IMAGES_QUERY, 'status', user?.email], queryFn: () => profileImagesApi.status.query(),
    enabled: !!import.meta.env.VITE_API_BASE_URL && !!user?.email, retry: false, refetchInterval: query => query.state.status === 'error' ? false : 15_000 })
  const admin = status.isSuccess
  const [folder, setFolder] = useState(''); const [dirty, setDirty] = useState(false)
  const [folderName, setFolderName] = useState(''); const [enteringLink, setEnteringLink] = useState(false); const [link, setLink] = useState('')
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('')
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]); const [pageToken, setPageToken] = useState<string>(); const [browsing, setBrowsing] = useState(false)
  const [folderPath, setFolderPath] = useState<FolderLocation[]>([MY_DRIVE])
  useEffect(() => { if (!dirty && status.data) { setFolder(status.data.folderId); setFolderName(status.data.folderName) } }, [status.data?.folderId, status.data?.folderName, dirty])
  async function run(action: string, work: () => Promise<void>) {
    setBusy(action); setError(''); setMessage('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'Profile Images action failed.') }
    finally { setBusy('') }
  }
  async function refreshed() { notifyProfileImages(); await queryClient.invalidateQueries({ queryKey: PROFILE_IMAGES_QUERY }) }
  async function browse(path: FolderLocation[], more = false) {
    await run('folders', async () => {
      const page = await profileImagesApi.folders.query({ parentId: path[path.length - 1].id, ...(more && pageToken ? { pageToken } : {}) })
      setFolders(current => more ? [...new Map([...current, ...page.files].map(item => [item.id, item])).values()] : page.files)
      setFolderPath(path); setPageToken(page.nextPageToken); setBrowsing(true)
    })
  }
  function chooseFolder(selected: FolderLocation) {
    setFolder(selected.id); setFolderName(selected.name); setDirty(true); setBrowsing(false); setEnteringLink(false); setLink(''); setMessage(`Selected ${selected.name}. Save to apply.`)
  }
  let extracted = ''; let invalid = ''
  try { extracted = folderIdFromInput(folder) } catch { invalid = 'Paste a valid Google Drive folder link, or use Browse folders.' }
  const syncMessage = (result: { folderName: string; matchedCount: number; imageCount: number; error: string | null; warnings: string[]; waiting?: string[] }) =>
    result.error ? 'Photos could not be updated. See the connection error.' : !result.folderName ? 'Drive profile images are disabled.' :
      `${result.folderName}: ${result.matchedCount} of ${result.imageCount} photos matched to people.${result.waiting?.length ? ` ${result.waiting.length} waiting for a matching person.` : ''}`
  const connectionResult = new URLSearchParams(window.location.search).get('profile_connection')
  return <>
    {status.isError && <p role="alert" className="text-sm text-crimson">{status.error.message}</p>}
    {status.isPending && user?.email ? <p role="status" className="text-sm text-muted">Loading Profile Images settings…</p> : !admin ? <p className="text-sm text-muted">A System Admin can configure the shared Profile Images folder.</p> : <>
      {status.isPending && <p role="status" className="text-sm text-muted">Loading Profile Images settings…</p>}
      {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
      {connectionResult && <p role="status" className="text-sm text-muted">{connectionResult === 'connected' ? 'Google Drive connected.' : `Google Drive connection: ${connectionResult.replace(/_/g, ' ')}. Connect again to retry.`}</p>}
      {status.data && <>
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div><dt className="text-muted">Connection</dt><dd className="mt-1 font-medium text-ink">{status.data.status === 'connected' ? 'Connected' : status.data.status === 'error' ? 'Sync error' : 'Not connected'}</dd></div>
          <div><dt className="text-muted">Last sync</dt><dd className="mt-1 text-ink">{status.data.lastSyncAt ? new Date(status.data.lastSyncAt).toLocaleString() : 'Not synced'}</dd></div>
          <div><dt className="text-muted">Photos found</dt><dd className="mt-1 text-ink">{status.data.imageCount}</dd></div>
          <div><dt className="text-muted">People matched</dt><dd className="mt-1 text-ink">{status.data.matchedCount}</dd></div>
        </dl>
        {status.data.accountEmail && <p className="text-xs text-muted">Connected as {status.data.accountEmail}{status.data.folderName ? ` · ${status.data.folderName}` : ''}</p>}
        {status.data.error && <p role="alert" className="text-sm text-crimson">{status.data.error}</p>}
        {!!status.data.waiting?.length && <details className="text-xs text-muted"><summary>{status.data.waiting!.length} {status.data.waiting!.length === 1 ? 'photo is' : 'photos are'} waiting for a matching person</summary><p className="mt-2">These photos will appear automatically once a person with the same name is added. Nothing to fix.</p><ul className="mt-2 list-disc space-y-1 pl-4">{status.data.waiting!.map(name => <li key={name}>{name}</li>)}</ul></details>}
        {!!status.data.warnings.length && <details className="text-xs text-muted"><summary>{status.data.warnings.length} {status.data.warnings.length === 1 ? 'photo needs' : 'photos need'} attention</summary><ul className="mt-2 list-disc space-y-1 pl-4">{status.data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
        {!status.data.oauthReady && <p className="text-xs text-muted">Set up the existing server Google OAuth client, registered callback, and encryption key to enable private Drive access.</p>}
        <div role="group" aria-label="Selected photo folder" className="space-y-3 rounded-xl border border-line p-4">
          <p className="text-xs font-medium text-muted">Photo folder</p>
          <div className="flex items-center gap-3"><Folder size={22} className="shrink-0 text-muted" /><div className="min-w-0"><p className="break-words text-sm font-semibold text-ink">{folder ? folderName || 'Folder link added' : 'No folder selected'}</p><p className="mt-0.5 text-xs text-muted">{dirty ? 'Save to apply this change.' : 'Only people with access in GOMS can view these photos.'}</p></div></div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!!busy || !canEdit || !status.data.accountEmail} onClick={() => void browse([MY_DRIVE])}>Browse folders</Button>
            <Button size="sm" variant="ghost" disabled={!!busy || !canEdit} onClick={() => setEnteringLink(!enteringLink)}>Paste folder link</Button>
            {folder && <Button size="sm" variant="ghost" disabled={!!busy || !canEdit} onClick={() => { setFolder(''); setFolderName(''); setDirty(true); setEnteringLink(false); setLink(''); setMessage('Save to stop using Drive profile images.') }}>Remove folder</Button>}
          </div>
          {enteringLink && <Field label="Google Drive folder link" hint="In Google Drive, open your photo folder and copy its link here."><Input aria-label="Google Drive folder link" value={link} disabled={!!busy || !canEdit} onChange={e => { setLink(e.target.value); setFolder(e.target.value); setFolderName(''); setDirty(true) }} placeholder="https://drive.google.com/drive/folders/…" /></Field>}
          {invalid && <p role="alert" className="text-xs text-crimson">{invalid}</p>}
        </div>
        {browsing && <div role="group" aria-label="Google Drive folder browser" className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="icon" variant="ghost" aria-label="Back to parent folder" disabled={!!busy || folderPath.length === 1} onClick={() => void browse(folderPath.slice(0, -1))}><ArrowLeft size={15} /></Button>
            <nav aria-label="Folder path" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[13px]">
              {folderPath.map((item, i) => <span key={item.id} className="inline-flex min-w-0 items-center gap-1">{i > 0 && <ChevronRight size={13} className="shrink-0 text-muted" />}<button type="button" className="max-w-48 truncate rounded px-1.5 py-1 text-ink hover:bg-panel focus-visible:focus-ring" disabled={!!busy} aria-current={i === folderPath.length - 1 ? 'location' : undefined} onClick={() => void browse(folderPath.slice(0, i + 1))}>{item.name}</button></span>)}
            </nav>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setBrowsing(false)}>Close</Button>
          </div>
          <p className="text-xs text-muted">Open a folder to see its subfolders, or choose Use folder.</p>
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line scrollbar-thin">
            {folders.map(item => <li key={item.id} className="flex items-center gap-2 px-2 py-1.5">
              <button type="button" aria-label={`Open ${item.name}`} disabled={!!busy} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-ink hover:bg-panel focus-visible:focus-ring" onClick={() => void browse([...folderPath, item])}><Folder size={18} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{item.name}</span><ChevronRight size={14} className="shrink-0 text-muted" /></button>
              <Button size="sm" disabled={!!busy || !canEdit} aria-label={`Use folder ${item.name}`} onClick={() => chooseFolder(item)}>Use folder</Button>
            </li>)}
            {!folders.length && <li className="px-3 py-6 text-center text-sm text-muted">No subfolders here.{folderPath.length > 1 ? ' You can use this folder.' : ''}</li>}
          </ul>
          <div className="flex flex-wrap justify-between gap-2">
            {pageToken && <Button size="sm" disabled={!!busy} onClick={() => void browse(folderPath, true)}>Load more folders</Button>}
            {folderPath.length > 1 && <Button size="sm" disabled={!!busy || !canEdit} onClick={() => chooseFolder(folderPath[folderPath.length - 1])}>Use this folder</Button>}
          </div>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!busy || !canEdit || !status.data.oauthReady} onClick={() => void run('connect', async () => { const result = await profileImagesApi.connect.mutate(); window.location.assign(result.url) })}>{status.data.accountEmail ? 'Reconnect Google Drive' : 'Connect Google Drive'}</Button>
          <Button size="sm" disabled={!!busy || !canEdit || !extracted || !!invalid || !status.data.accountEmail} onClick={() => void run('test', async () => { const result = await profileImagesApi.test.mutate({ folder }); setFolderName(result.name); setMessage(`Connection successful: ${result.name}`) })}>Test Connection</Button>
          <Button size="sm" variant="primary" disabled={!!busy || !canEdit || !!invalid || (!!folder && !status.data.accountEmail)} onClick={() => void run('save', async () => { const result = await profileImagesApi.save.mutate({ folder }); setDirty(false); setFolder(result.folderId); setFolderName(result.folderName); setEnteringLink(false); setLink(''); await refreshed(); setMessage(syncMessage(result)) })}>Save</Button>
          <Button size="sm" disabled={!!busy || !canEdit || dirty || !status.data.folderId || !status.data.accountEmail} onClick={() => void run('sync', async () => { const result = await profileImagesApi.sync.mutate(); await refreshed(); setMessage(syncMessage(result)) })}>Sync Now</Button>
        </div>
        {busy && <p role="status" className="text-xs text-muted">{busy === 'save' || busy === 'sync' ? 'Synchronizing Profile Images…' : busy === 'folders' ? 'Loading folders…' : 'Connecting to Google Drive…'}</p>}
        {message && <p role="status" className="text-sm text-ink">{message}</p>}
        <p className="text-xs text-muted">Photos are matched to Employees, Sales, team rosters and People contacts. Name each JPG, PNG or WebP exactly as the person's full name in GOMS, e.g. Shubham Mehra.png (capitals don't matter). People without a photo show their initials.</p>
        <p className="text-xs text-muted">Changes are checked incrementally every minute while the server runs. Sync Now refreshes employee photos after completion. Photos for people not yet in GOMS wait and appear automatically once the person is added.</p>
      </>}
    </>}
  </>
}

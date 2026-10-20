import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthUser } from '@/lib/auth'
import { useNodeAccess } from '@/lib/rbacTree'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { folderIdFromInput } from './settings'
import { notifyProfileImages, PROFILE_IMAGES_QUERY, profileImagesApi } from './profileImagesClient'

export function ProfileImagesSettings() {
  return <section className="mt-6 space-y-4 rounded-xl border border-line bg-white p-4 sm:p-6" aria-labelledby="profile-images-title">
    <div><h2 id="profile-images-title" className="text-base font-semibold text-ink-900">Profile Images</h2><p className="mt-1 text-[13px] text-muted">Match JPG, PNG, and WebP filenames to People IDs or emails, with full names as a fallback. Images remain private in Google Drive.</p></div>
    {import.meta.env.VITE_API_BASE_URL ? <ConnectedProfileImagesSettings /> : <p className="text-sm text-muted">Profile Images requires the connected GOMS server.</p>}
  </section>
}
function ConnectedProfileImagesSettings() {
  const { user } = useAuthUser(); const canEdit = useNodeAccess('settings.system.storage', 'edit')
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: [...PROFILE_IMAGES_QUERY, 'status', user?.email], queryFn: () => profileImagesApi.status.query(),
    enabled: !!import.meta.env.VITE_API_BASE_URL && !!user?.email, retry: false, refetchInterval: query => query.state.status === 'error' ? false : 15_000 })
  const admin = status.isSuccess
  const [folder, setFolder] = useState(''); const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('')
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]); const [pageToken, setPageToken] = useState<string>(); const [browsing, setBrowsing] = useState(false)
  useEffect(() => { if (!dirty && status.data) setFolder(status.data.folderId) }, [status.data?.folderId, dirty])
  async function run(action: string, work: () => Promise<void>) {
    setBusy(action); setError(''); setMessage('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'Profile Images action failed.') }
    finally { setBusy('') }
  }
  async function refreshed() { notifyProfileImages(); await queryClient.invalidateQueries({ queryKey: PROFILE_IMAGES_QUERY }) }
  let extracted = ''; let invalid = ''
  try { extracted = folderIdFromInput(folder) } catch { invalid = 'Enter a Google Drive folder URL or folder ID.' }
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
          <div><dt className="text-muted">Images indexed</dt><dd className="mt-1 text-ink">{status.data.imageCount}</dd></div>
          <div><dt className="text-muted">People matched</dt><dd className="mt-1 text-ink">{status.data.matchedCount}</dd></div>
        </dl>
        {status.data.accountEmail && <p className="text-xs text-muted">Connected as {status.data.accountEmail}{status.data.folderName ? ` · ${status.data.folderName}` : ''}</p>}
        {status.data.error && <p role="alert" className="text-sm text-crimson">{status.data.error}</p>}
        {!!status.data.warnings.length && <details className="text-xs text-muted"><summary>{status.data.warnings.length} matching errors</summary><ul className="mt-2 list-disc space-y-1 pl-4">{status.data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
        {!status.data.oauthReady && <p className="text-xs text-muted">Set up the existing server Google OAuth client, registered callback, and encryption key to enable private Drive access.</p>}
        <Field label="Profile Images folder URL or ID" hint="Choose a folder accessible to the connected Google account. Leave blank and save to disable Drive profile images."><Input value={folder} disabled={!!busy || !canEdit} onChange={e => { setFolder(e.target.value); setDirty(true) }} placeholder="https://drive.google.com/drive/folders/…" /></Field>
        {folder && <p className={`text-xs ${invalid ? 'text-crimson' : 'text-muted'}`}>{invalid || `Folder ID: ${extracted}`}</p>}
        {browsing && <div className="space-y-2"><Field label="Accessible Google Drive folders"><Select value="" disabled={!!busy || !canEdit} onChange={e => { if (e.target.value) { setFolder(e.target.value); setDirty(true) } }}><option value="">Select a folder…</option>{folders.map(item => <option value={item.id} key={item.id}>{item.name} ({item.id})</option>)}</Select></Field>{pageToken && <Button size="sm" disabled={!!busy} onClick={() => void run('folders', async () => { const page = await profileImagesApi.folders.query({ pageToken }); setFolders(current => [...current, ...page.files]); setPageToken(page.nextPageToken) })}>Load more folders</Button>}</div>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!busy || !canEdit || !status.data.oauthReady} onClick={() => void run('connect', async () => { const result = await profileImagesApi.connect.mutate(); window.location.assign(result.url) })}>{status.data.accountEmail ? 'Reconnect Google Drive' : 'Connect Google Drive'}</Button>
          <Button size="sm" disabled={!!busy || !canEdit || !status.data.accountEmail} onClick={() => void run('folders', async () => { const page = await profileImagesApi.folders.query({}); setFolders(page.files); setPageToken(page.nextPageToken); setBrowsing(true) })}>Browse folders</Button>
          <Button size="sm" disabled={!!busy || !canEdit || !extracted || !!invalid || !status.data.accountEmail} onClick={() => void run('test', async () => { const result = await profileImagesApi.test.mutate({ folder }); setMessage(`Connection successful: ${result.name}`) })}>Test Connection</Button>
          <Button size="sm" variant="primary" disabled={!!busy || !canEdit || !!invalid || (!!folder && !status.data.accountEmail)} onClick={() => void run('save', async () => { const result = await profileImagesApi.save.mutate({ folder }); setDirty(false); setFolder(result.folderId); await refreshed(); setMessage(result.error ? 'Folder saved. Resolve the sync error and retry.' : 'Profile Images saved and synchronized.') })}>Save</Button>
          <Button size="sm" disabled={!!busy || !canEdit || dirty || !status.data.folderId || !status.data.accountEmail} onClick={() => void run('sync', async () => { const result = await profileImagesApi.sync.mutate(); await refreshed(); setMessage(result.error ? 'Sync failed. See the connection error.' : 'Profile Images synchronized.') })}>Sync Now</Button>
        </div>
        {busy && <p role="status" className="text-xs text-muted">{busy === 'save' || busy === 'sync' ? 'Synchronizing Profile Images…' : 'Connecting to Google Drive…'}</p>}
        {message && <p role="status" className="text-sm text-ink">{message}</p>}
        <p className="text-xs text-muted">Changes are checked incrementally every minute while the server runs. Sync Now refreshes People after completion. Duplicate names need a unique ID or email filename.</p>
      </>}
    </>}
  </>
}

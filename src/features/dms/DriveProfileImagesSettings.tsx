import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNodeAccess } from '@/lib/rbacTree'
import { useDirectoryTypes } from '@/features/masters/useMasterOptions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { disconnectDrive, getDriveSession, loadGoogleIdentity } from './googleDrive'
import {
  connectDrivePhotos, DRIVE_PHOTOS_CONNECTION, hasPhotoFolders, loadPhotoFolders, photoCategories, savePhotoFolders, type CategoryReport,
} from './driveProfileImages'
import { DRIVE_LISTINGS_QUERY, useDrivePhotoIndex } from './useDrivePhotoIndex'

/** Serverless Profile Images: one Drive folder per people category, read by this browser's own Google sign-in. */
export function DriveProfileImagesSettings() {
  const canEdit = useNodeAccess('settings.system.storage', 'edit')
  const queryClient = useQueryClient()
  const directoryTypes = useDirectoryTypes()
  const categories = useMemo(() => photoCategories(directoryTypes), [directoryTypes])
  const [session, setSession] = useState(() => getDriveSession(DRIVE_PHOTOS_CONNECTION))
  const [links, setLinks] = useState<Record<string, string>>(() => loadPhotoFolders())
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const { index, isFetching, error: listError } = useDrivePhotoIndex()

  // Preload Google sign-in only once folders exist, so the Connect click can open its popup straight away.
  const hasFolders = hasPhotoFolders()
  useEffect(() => { if (hasFolders) void loadGoogleIdentity().catch(() => {}) }, [hasFolders])
  useEffect(() => {
    const changed = () => setSession(getDriveSession(DRIVE_PHOTOS_CONNECTION))
    window.addEventListener('goms:dms-session-changed', changed)
    return () => window.removeEventListener('goms:dms-session-changed', changed)
  }, [])

  async function run(action: string, work: () => Promise<unknown>) {
    setBusy(action); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'Profile photos action failed.') } finally { setBusy('') }
  }
  const sync = () => queryClient.invalidateQueries({ queryKey: DRIVE_LISTINGS_QUERY })
  const totals = Object.values(index.report).reduce((sum, r) => ({ photos: sum.photos + r.photos, used: sum.used + r.used }), { photos: 0, used: 0 })

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
      <div>
        <p className="text-sm font-semibold text-ink">{session ? `Connected as ${session.email || 'Google account'}` : 'Google Drive not connected'}</p>
        <p className="mt-0.5 text-xs text-muted">{session ? `${totals.used} of ${totals.photos} photos in use across all categories. Folders are re-read every minute.` : 'Connect once per browser tab. Your own Drive access decides which photos you can see.'}</p>
      </div>
      <div className="flex gap-2">
        {session
          ? <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { disconnectDrive(DRIVE_PHOTOS_CONNECTION); void sync() }}>Disconnect</Button>
          : <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void run('connect', async () => { await connectDrivePhotos(); await sync() })}>Connect Google Drive</Button>}
        <Button size="sm" disabled={!!busy || !session || dirty} onClick={() => void run('sync', sync)}>Sync now</Button>
      </div>
    </div>

    <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Photo folders by category">
      {categories.map(({ key, label, hint }) => <li key={key} className="grid gap-2 p-4 sm:grid-cols-[12rem_1fr] sm:items-start">
        <div><p className="text-sm font-medium text-ink">{label}</p><p className="text-xs text-muted">{hint}</p></div>
        <div className="space-y-1.5">
          <Input aria-label={`${label} photo folder link`} value={links[key] ?? ''} disabled={!!busy || !canEdit} placeholder="https://drive.google.com/drive/folders/…"
            onChange={(e) => { setLinks((current) => ({ ...current, [key]: e.target.value })); setDirty(true) }} className="h-9 text-[13px]" />
          <CategoryStatus linked={!!links[key]?.trim()} connected={!!session} dirty={dirty} report={index.report[key]} />
        </div>
      </li>)}
    </ul>

    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" disabled={!!busy || !canEdit || !dirty} onClick={() => void run('save', async () => { setLinks(savePhotoFolders(links, categories)); setDirty(false); await sync() })}>Save &amp; sync</Button>
      {dirty && <span className="text-xs text-muted">Unsaved folder changes.</span>}
      {busy === 'connect' && <span role="status" className="text-xs text-muted">Connecting to Google Drive…</span>}
      {busy !== 'connect' && (busy || isFetching) && <span role="status" className="text-xs text-muted">Reading photo folders…</span>}
    </div>
    {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
    {listError && <p role="alert" className="text-sm text-crimson">{listError.message}</p>}
    <p className="text-xs text-muted">Name each JPG, PNG or WebP by the person's ID (6001.jpg; Amnex: 1234.jpg or AIPL-1234.jpg), by their full name (Asha Rao.jpg), or both (Asha Rao 6001.jpg). Each folder matches only its own category's people. Nothing is guessed: unknown IDs, shared names, a name and ID that disagree, or two photos for one person stay unmatched and are listed below. Folder links are saved in this browser.</p>
  </div>
}

function CategoryStatus({ linked, connected, dirty, report }: { linked: boolean; connected: boolean; dirty: boolean; report?: CategoryReport }) {
  if (!linked) return <p className="text-xs text-muted">No folder linked.</p>
  if (!connected) return <p className="text-xs text-muted">Connect Google Drive to sync.</p>
  if (dirty || !report) return <p className="text-xs text-muted">Save to sync this folder.</p>
  if (report.error) return <p role="alert" className="text-xs text-crimson">Photo sync failed: {report.error} Current photos are kept.</p>
  const problems = [...report.duplicates, ...report.conflicts, ...report.unmatched, ...report.warnings]
  return <div className="text-xs">
    <p className="text-ink">{report.used} of {report.photos} photos in use · {report.missing} {report.missing === 1 ? 'person' : 'people'} without a photo</p>
    {!!problems.length && <details className="mt-1 text-muted"><summary>{problems.length} {problems.length === 1 ? 'photo needs' : 'photos need'} attention</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></details>}
  </div>
}

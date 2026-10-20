import { useMemo, useState } from 'react'
import { useSalesPersonMutations, useSalesPersons } from '@/lib/api'
import { useAllowed } from '@/lib/permissions'
import { loadConnections } from '@/features/dms/connections'
import { connectDrive, downloadFile, getDriveSession, listFiles, loadGoogleIdentity } from '@/features/dms/googleDrive'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Input } from '@/components/ui/Field'
import { IMAGE_FILE, driveFolderId, matchPhoto, toAvatarDataUrl } from './salesPhotoMatch'

/** Folder of sales team photos shared for GOMS (file name = person's name). */
const DEFAULT_FOLDER = 'https://drive.google.com/drive/folders/19nqxKqXXBI1tgaZekdkvRougTDAmAAll'

/** Settings > Masters > Sales Team Photos: match photos in a Drive folder to sales people by name, review
 *  (change or skip any match), then save them as profile photos. Uses the existing DMS Google Drive
 *  connection and the signed-in user's own Drive access. */
export function SalesPhotosFromDrive() {
  const { data: people = [] } = useSalesPersons()
  const { update } = useSalesPersonMutations()
  const allowed = useAllowed('team.sales', 'update')
  const drive = loadConnections().find(c => c.settings.provider === 'google-drive' && c.settings.clientId)
  const [folder, setFolder] = useState(DEFAULT_FOLDER)
  const [files, setFiles] = useState<{ id: string; name: string }[] | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [done, setDone] = useState('')
  const active = useMemo(() => people.filter(p => p.status !== 'inactive' && p.status !== 'resigned').sort((a, b) => a.name.localeCompare(b.name)), [people])

  async function load() {
    if (!drive) return
    setError(''); setDone(''); setBusy('Reading the Drive folder…')
    try {
      if (!getDriveSession(drive.id)) { await loadGoogleIdentity(); await connectDrive(drive.settings.clientId, drive.id) }
      const images = (await listFiles(driveFolderId(folder), drive.id)).filter(f => IMAGE_FILE.test(f.name) || f.mimeType?.startsWith('image/'))
      setFiles(images)
      setChoice(Object.fromEntries(active.flatMap(p => { const m = matchPhoto(p.name, images); return m ? [[p.id, m.id]] : [] })))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read that folder.') } finally { setBusy('') }
  }
  async function save() {
    if (!drive) return
    const picks = Object.entries(choice).filter(([, fileId]) => fileId)
    setError(''); setDone('')
    let saved = 0; const failed: string[] = []
    for (const [personId, fileId] of picks) {
      const person = active.find(p => p.id === personId)
      setBusy(`Saving ${saved + failed.length + 1} of ${picks.length}${person ? ` — ${person.name}` : ''}…`)
      try { await update.mutateAsync({ id: personId, patch: { photoUrl: await toAvatarDataUrl(await downloadFile(fileId, drive.id)) } }); saved++ }
      catch { failed.push(person?.name ?? personId) }
    }
    setBusy(''); setDone(`${saved} photo${saved === 1 ? '' : 's'} saved.`)
    if (failed.length) setError(`Could not save: ${failed.join(', ')}.`)
  }

  if (!drive) return <p className="p-6 text-[13px] text-muted">Set up a Google Drive connection in Settings › DMS first; photos are read with your own Drive access.</p>
  const options = (files ?? []).map(f => ({ value: f.id, label: f.name }))
  const picked = Object.values(choice).filter(Boolean).length
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <p className="max-w-2xl text-[13px] text-muted">Photos are matched to sales people by file name (for example "Ashish Desai.jpg"). Review each match: change it, or clear it to skip that person. Photos are cropped square and saved on the person.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Drive folder link" value={folder} onChange={e => setFolder(e.target.value)} className="min-w-72 flex-1" />
        <Button disabled={!!busy} onClick={() => void load()}>{files ? 'Reload folder' : 'Read folder'}</Button>
        {files && allowed && <Button variant="primary" disabled={!!busy || !picked} onClick={() => void save()}>Save {picked} photo{picked === 1 ? '' : 's'}</Button>}
      </div>
      {busy && <p role="status" className="text-[13px] text-muted">{busy}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800">{error}</p>}
      {done && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-[13px] text-emerald-800">{done}</p>}
      {files && <>
        <p className="text-[13px] text-muted">{files.length} images in the folder · {picked} of {active.length} people matched</p>
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {active.map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar person={{ name: p.name, photoUrl: p.photoUrl }} size="md" />
              <span className="min-w-40 flex-1"><span className="block text-[14px] font-medium text-ink-900">{p.name}</span><span className="block text-[12px] text-muted">{p.photoUrl ? 'Has a photo' : 'No photo yet'}</span></span>
              <Combobox aria-label={`Photo for ${p.name}`} className="w-72" value={choice[p.id] ?? ''} placeholder="No photo — skip" options={options}
                onChange={value => setChoice(c => ({ ...c, [p.id]: value }))} />
              {choice[p.id] && <Button size="sm" variant="ghost" onClick={() => setChoice(c => ({ ...c, [p.id]: '' }))}>Skip</Button>}
            </li>
          ))}
        </ul>
      </>}
    </div>
  )
}

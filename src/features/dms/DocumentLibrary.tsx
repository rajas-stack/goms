import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, Folder, FolderPlus, History, Loader2, Pencil, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { createFolder, FOLDER_MIME, getDriveSession, listFiles, renameFile, trashFile, uploadFile, type DriveFile } from './googleDrive'
import { formatBytes, validateUpload, type DmsSettings } from './settings'
import { mirrorUpload } from './masterSync'

const CATEGORIES = ['General', 'Tender documents', 'Contracts', 'Invoices', 'Reports', 'Other']
type EditAction = { kind: 'folder' } | { kind: 'rename' | 'trash'; file: DriveFile }

export function DocumentLibrary({ root, settings, onSessionExpired, connectionId = 'default' }: { root: DriveFile; settings: DmsSettings; onSessionExpired: () => void; connectionId?: string }) {
  const toast = useToast()
  const [path, setPath] = useState([root])
  const folder = path[path.length - 1]
  const [files, setFiles] = useState<DriveFile[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('General')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<EditAction | null>(null)
  const [name, setName] = useState('')
  const [replace, setReplace] = useState<DriveFile | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const expiredRef = useRef(onSessionExpired)
  expiredRef.current = onSessionExpired

  const refresh = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    try {
      const result = await listFiles(folder.id, connectionId)
      if (request === generation.current) { setFiles(result); setError('') }
    } catch (e) {
      if (request === generation.current) {
        setError(e instanceof Error ? e.message : 'Could not load documents.')
        if (!getDriveSession(connectionId)) expiredRef.current()
      }
    } finally { if (request === generation.current) setLoading(false) }
  }, [folder.id, connectionId])

  useEffect(() => {
    setFiles([]); setEdit(null); setQuery(''); setFilter('all')
    void refresh()
    return () => { generation.current++ }
  }, [refresh])

  useEffect(() => {
    if (!settings.autoRefresh || busy || edit) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60000)
    return () => window.clearInterval(timer)
  }, [settings.autoRefresh, busy, edit, refresh])

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action); setError('')
    try { await work() } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation could not be completed.')
      if (!getDriveSession(connectionId)) onSessionExpired()
    } finally { setBusy('') }
  }

  async function upload(selected: File[]) {
    if (!selected.length) return
    const replacement = replace
    setReplace(null)
    await run('upload', async () => {
      selected.forEach((file) => validateUpload(file, settings))
      let uploaded = 0
      let masterPending = false
      try {
        for (const file of selected) {
          const document = await uploadFile(file, folder.id, replacement?.appProperties?.category ?? category, replacement?.id, connectionId)
          uploaded++
          try { await mirrorUpload(connectionId, document, path) } catch { masterPending = true }
        }
        toast((replacement ? `New version uploaded: ${replacement.name}` : `${uploaded} document${uploaded === 1 ? '' : 's'} uploaded to Drive.`) + (masterPending ? ' Master copy pending; reconnect the master DMS and collect documents.' : ''))
      } catch (e) {
        if (uploaded) toast(`${uploaded} document${uploaded === 1 ? '' : 's'} uploaded before the upload stopped.`)
        throw e
      } finally { await refresh() }
    })
  }

  function chooseUpload(file?: DriveFile) {
    setReplace(file ?? null)
    if (inputRef.current) { inputRef.current.multiple = !file; inputRef.current.click() }
  }

  const visible = files.filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || (file.appProperties?.category ?? 'General') === filter))
  const documents = files.filter((file) => file.mimeType !== FOLDER_MIME)
  const canUpload = folder.capabilities?.canAddChildren !== false

  return (
    <div className="space-y-4">
      <nav aria-label="Document folders" className="flex flex-wrap items-center gap-1 text-[13px] text-muted">{path.map((item, index) => <span className="flex items-center gap-1" key={item.id}>{index > 0 && <span>/</span>}<button disabled={!!busy} onClick={() => setPath(path.slice(0, index + 1))} className="rounded px-1 py-0.5 font-medium text-ink hover:bg-panel focus-visible:focus-ring">{item.name}</button></span>)}</nav>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-muted" /><Input aria-label="Search documents" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents…" className="pl-9" /></div>
        <Select aria-label="Filter by category" className="w-auto max-w-[180px]" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All categories</option>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</Select>
        <Button size="icon" aria-label="Refresh documents" disabled={loading || !!busy} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{documents.length} document{documents.length === 1 ? '' : 's'} · {files.length - documents.length} folder{files.length - documents.length === 1 ? '' : 's'} · {formatBytes(documents.reduce((total, file) => total + Number(file.size ?? 0), 0))}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Upload category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-auto max-w-[160px] py-1 text-xs" disabled={!!busy || !canUpload}>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</Select>
          <Button size="sm" disabled={!!busy || !canUpload} onClick={() => { setEdit({ kind: 'folder' }); setName('') }}><FolderPlus size={14} />New folder</Button>
          <Button size="sm" variant="primary" disabled={!!busy || !canUpload} onClick={() => chooseUpload()}>{busy === 'upload' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}Upload</Button>
        </div>
      </div>
      <input ref={inputRef} type="file" multiple className="hidden" aria-label="Choose documents" accept={settings.allowedFiles === 'pdf' ? '.pdf' : settings.allowedFiles === 'documents' ? '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.rtf,.png,.jpg,.jpeg,.webp,.gif' : undefined} onChange={(e) => { const selected = Array.from(e.target.files ?? []); e.target.value = ''; void upload(selected) }} />
      {error && <p role="alert" className="rounded-lg border border-crimson/20 bg-crimson/5 p-3 text-[13px] text-crimson">{error}</p>}
      {edit && <form className="space-y-3 rounded-xl border border-line bg-white p-4" onSubmit={(e) => {
        e.preventDefault()
        void run(edit.kind, async () => {
          if (edit.kind === 'trash') { await trashFile(edit.file.id, connectionId); toast(`${edit.file.name} moved to Google Drive trash.`) }
          else {
            if (!name.trim()) throw new Error('Enter a name.')
            if (edit.kind === 'folder') await createFolder(name.trim(), folder.id, connectionId)
            else await renameFile(edit.file.id, name.trim(), connectionId)
            toast(edit.kind === 'folder' ? 'Folder created.' : 'Document renamed.')
          }
          setEdit(null)
          await refresh()
        })
      }}>
        {edit.kind === 'trash' ? <div><h4 className="text-sm font-semibold text-ink">Move “{edit.file.name}” to trash?</h4><p className="mt-1 text-xs text-muted">{edit.file.mimeType === FOLDER_MIME ? 'This also moves the documents inside this folder to trash. ' : ''}You can restore it from Google Drive.</p></div> : <Field label={edit.kind === 'folder' ? 'Folder name' : 'Document name'}><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={255} disabled={!!busy} /></Field>}
        <div className="flex justify-end gap-2"><Button size="sm" disabled={!!busy} onClick={() => setEdit(null)}>Cancel</Button><Button size="sm" type="submit" variant={edit.kind === 'trash' ? 'danger' : 'primary'} disabled={!!busy}>{busy ? 'Saving…' : edit.kind === 'trash' ? 'Move to trash' : 'Save'}</Button></div>
      </form>}
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {loading && !files.length ? <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-muted"><Loader2 size={18} className="animate-spin" />Loading documents…</div> : !visible.length ? <div className="flex flex-col items-center px-6 py-12 text-center"><FileText size={30} className="mb-3 text-muted" /><h4 className="text-sm font-medium text-ink">{query || filter !== 'all' ? 'No matching documents' : error ? 'Documents could not be loaded' : 'This folder is empty'}</h4><p className="mt-1 text-xs text-muted">{query || filter !== 'all' ? 'Try a different search or category.' : error ? 'Check the connection and refresh to try again.' : 'Upload your first document or create a folder.'}</p></div> : <div className="max-h-[360px] overflow-auto scrollbar-thin"><table className="w-full text-left text-[13px]"><thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-2.5 font-medium">Document</th><th className="hidden px-3 py-2.5 font-medium sm:table-cell">Modified</th><th className="hidden px-3 py-2.5 font-medium sm:table-cell">Size</th><th className="px-3 py-2.5 text-right font-medium">Actions</th></tr></thead><tbody className="divide-y divide-line">{visible.map((file) => <tr key={file.id} className="hover:bg-panel/50">
          <td className="max-w-[280px] px-4 py-3"><div className="flex items-center gap-2.5">{file.mimeType === FOLDER_MIME ? <Folder size={19} className="shrink-0 text-amber-600" /> : <FileText size={19} className="shrink-0 text-indigo" />}<div className="min-w-0">{file.mimeType === FOLDER_MIME ? <button disabled={!!busy} className="block truncate text-left font-medium text-ink hover:underline" onClick={() => setPath([...path, file])}>{file.name}</button> : <a href={file.webViewLink ?? `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-ink hover:underline">{file.name}</a>}<span className="text-[11px] text-muted">{file.mimeType === FOLDER_MIME ? 'Folder' : file.appProperties?.category ?? 'General'}</span></div></div></td>
          <td className="hidden whitespace-nowrap px-3 py-3 text-xs text-muted sm:table-cell">{file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : '—'}</td>
          <td className="hidden whitespace-nowrap px-3 py-3 text-xs text-muted sm:table-cell">{formatBytes(Number(file.size ?? 0))}</td>
          <td className="px-3 py-3"><div className="flex justify-end gap-0.5">{file.mimeType !== FOLDER_MIME && <a aria-label={`Open ${file.name} in Drive`} title="Open in Google Drive" href={file.webViewLink ?? `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`} target="_blank" rel="noopener noreferrer" className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink"><ExternalLink size={14} /></a>}{!file.mimeType.startsWith('application/vnd.google-apps.') && file.capabilities?.canEdit !== false && <Button variant="ghost" size="icon" title="Upload a new version" aria-label={`Upload new version of ${file.name}`} disabled={!!busy} onClick={() => chooseUpload(file)}><History size={14} /></Button>}{file.capabilities?.canEdit !== false && <Button variant="ghost" size="icon" title="Rename" aria-label={`Rename ${file.name}`} disabled={!!busy} onClick={() => { setEdit({ kind: 'rename', file }); setName(file.name) }}><Pencil size={14} /></Button>}{file.capabilities?.canTrash !== false && <Button variant="ghost" size="icon" title="Move to trash" aria-label={`Move ${file.name} to trash`} disabled={!!busy} onClick={() => setEdit({ kind: 'trash', file })}><Trash2 size={14} /></Button>}</div></td>
        </tr>)}</tbody></table></div>}
      </div>
      <p className="text-xs text-muted">Stored in Google Drive · Upload limit: {settings.maxUploadMb === null ? 'No app limit' : `${settings.maxUploadMb} MB`} · Open a document in Drive to download, share, or view its history.</p>
    </div>
  )
}

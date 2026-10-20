import { useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { loadConnections } from '@/features/dms/connections'
import { connectDrive, getDriveSession, listFiles, loadGoogleIdentity } from '@/features/dms/googleDrive'
import { driveFolderId } from '@/features/employees/salesPhotoMatch'
import { fileBase, fileType } from '@/features/email-center/emailUi'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SHOWN = 2

/** The DMS Google Drive connection used for opportunities (Settings › DMS), if any. */
const opportunityDrive = () => {
  const all = loadConnections().filter(c => c.settings.provider === 'google-drive' && c.settings.clientId)
  return all.find(c => c.modules.includes('opportunity')) ?? all.find(c => c.isMaster) ?? all[0]
}

/** Tender Folder Link cell: a Drive folder's files as compact chips (type icon + name without extension).
 *  "+N" opens the full list in a floating panel, so the grid row never changes size. Files open in Drive
 *  with the viewer's own permissions. A non-Drive link stays a plain link. */
export function TenderFolderCell({ url }: { url: string }) {
  const stop = (e: MouseEvent) => e.stopPropagation()
  const folderId = /drive\.google\.com/.test(url) ? driveFolderId(url) : ''
  const drive = opportunityDrive()
  const [connected, setConnected] = useState(() => !!(drive && getDriveSession(drive.id)))
  const [panel, setPanel] = useState<{ top: number; left: number } | null>(null)
  const files = useQuery({
    queryKey: ['tenderFolder', drive?.id, folderId], enabled: !!folderId && !!drive && connected, staleTime: 5 * 60_000, retry: false,
    queryFn: async () => (await listFiles(folderId, drive!.id)).filter(f => f.mimeType !== FOLDER_MIME),
  })
  if (!folderId || !drive) return <a href={url} target="_blank" rel="noreferrer" onClick={stop} className="truncate text-goms-navy underline decoration-goms-sky underline-offset-2">{url}</a>
  if (!connected) return (
    <span className="flex min-w-0 items-center gap-1.5">
      <a href={url} target="_blank" rel="noreferrer" onClick={stop} title={url} className="inline-flex items-center gap-1 text-goms-navy"><Icon name="Folder" size={14} />Folder</a>
      <button type="button" onClick={e => { stop(e); void loadGoogleIdentity().then(() => connectDrive(drive.settings.clientId, drive.id)).then(() => setConnected(true)).catch(() => undefined) }}
        className="text-[11.5px] text-muted underline" title="Connect Google Drive to list this folder's files">Show files</button>
    </span>
  )
  if (files.isLoading) return <span className="text-[12px] text-muted">Loading files…</span>
  if (files.isError) return <a href={url} target="_blank" rel="noreferrer" onClick={stop} className="inline-flex items-center gap-1 text-goms-navy" title={files.error instanceof Error ? files.error.message : 'Folder unavailable'}><Icon name="Folder" size={14} />Open folder</a>
  const list = files.data ?? []
  const chip = (f: (typeof list)[number], wide = false) => {
    const t = fileType(f.name, f.mimeType)
    return <a key={f.id} href={f.webViewLink ?? url} target="_blank" rel="noreferrer" onClick={stop} title={f.name}
      className={cn('inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] text-ink-800 hover:bg-ink-900/[0.05]', wide ? 'w-full' : 'max-w-[9rem]')}>
      <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded ring-1', t.tone)}><Icon name={t.icon} size={12} /></span>
      <span className="truncate">{fileBase(f.name)}</span>
    </a>
  }
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
      {list.length === 0 && <a href={url} target="_blank" rel="noreferrer" onClick={stop} className="inline-flex items-center gap-1 text-[12px] text-muted"><Icon name="Folder" size={14} />Empty folder</a>}
      {list.slice(0, SHOWN).map(f => chip(f))}
      {list.length > SHOWN && <button type="button" aria-expanded={!!panel} aria-label={`Show all ${list.length} files`}
        onClick={e => { stop(e); const r = e.currentTarget.getBoundingClientRect(); setPanel(p => (p ? null : { top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 300) })) }}
        className="shrink-0 rounded-md bg-ink-900/[0.06] px-1.5 text-[11.5px] font-medium text-ink-600 hover:bg-ink-900/[0.1]">+{list.length - SHOWN}</button>}
      {panel && createPortal(
        <div role="dialog" aria-label="Tender folder files" onClick={stop} onMouseLeave={() => setPanel(null)}
          style={{ top: panel.top, left: panel.left }} className="fixed z-50 max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-white p-1.5 shadow-[0_12px_32px_rgba(11,43,73,0.16)]">
          <div className="flex items-center justify-between px-1.5 pb-1 text-[11.5px] text-muted"><span>{list.length} files</span><a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink-900"><Icon name="ExternalLink" size={12} />Open folder</a></div>
          {list.map(f => chip(f, true))}
        </div>, document.body)}
    </span>
  )
}

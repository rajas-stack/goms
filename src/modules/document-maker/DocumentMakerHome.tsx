import { useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { useQueryClient } from '@tanstack/react-query'
import { KIND_LABELS, MAKER_LIMITS, type MakerDocument, type MakerDocumentKind } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import {
  collectPhoneAppEdits, downloadMakerDocument, editsInPhoneApp, openMakerDocumentInApp, openMakerDocumentInDesktopApp, type DesktopApp, readFileBase64, useCreateMakerDocument, useDeleteMakerDocument, useDuplicateMakerDocument,
  useMakerDocuments, useRenameMakerDocument, useUploadMakerDocument,
} from './api'
import { FileList, type FileAction } from './FileList'
import { useNodeFilter } from '@/lib/rbacTree/access'
import type { RbacAction } from '@goms/domain'

const DOCUMENT_MAKER_NODE = 'documentMaker'
const TREE_ACTION: Record<FileAction, RbacAction> = { rename: 'edit', duplicate: 'create', download: 'download', delete: 'delete', share: 'edit', versions: 'view', office: 'edit', libreOffice: 'edit' }
import { MAKER_KIND_ORDER } from './kinds'
import { NewFileTiles } from './NewFileTiles'
import { RenameDialog } from './RenameDialog'
import { ShareDialog } from './ShareDialog'
import { VersionsDialog } from './VersionsDialog'
import { DriveStrip } from './DriveStrip'
import { useCurrentOwner } from './useOwner'

type Sort = 'edited-desc' | 'edited-asc' | 'name'
type Filter = 'all' | MakerDocumentKind
type Scope = 'all' | 'mine' | 'shared'
const SCOPE_LABELS: Record<Scope, string> = { all: 'All', mine: 'Mine', shared: 'Shared with me' }

const SORTS: Record<Sort, (a: MakerDocument, b: MakerDocument) => number> = {
  'edited-desc': (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  'edited-asc': (a, b) => a.updatedAt.localeCompare(b.updatedAt),
  name: (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
}

const APP_LABELS: Record<DesktopApp, string> = { office: 'Microsoft Office', libreOffice: 'LibreOffice' }

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

export function DocumentMakerHome() {
  const toast = useToast()
  const owner = useCurrentOwner()
  const files = useMakerDocuments()
  const create = useCreateMakerDocument()
  const upload = useUploadMakerDocument()
  const rename = useRenameMakerDocument()
  const duplicate = useDuplicateMakerDocument()
  const remove = useDeleteMakerDocument()
  const tree = useNodeFilter()
  const inPhoneApp = editsInPhoneApp()
  const queryClient = useQueryClient()
  // Android: coming back from the phone's Word / Excel / PowerPoint uploads what it saved as a new version.
  useEffect(() => {
    if (!inPhoneApp) return
    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      void collectPhoneAppEdits().then(({ saved, errors }) => {
        if (saved.length) {
          void queryClient.invalidateQueries({ queryKey: ['makerDocuments'] })
          toast(saved.length === 1 ? `Saved your changes to "${saved[0].title}" as a new version.` : `Saved changes to ${saved.length} files as new versions.`)
        }
        if (errors.length) toast(`Could not save changes from the phone app. ${errors.join(' ')}`, undefined, 'error')
      })
    })
    return () => { void listener.then((handle) => handle.remove()) }
  }, [inPhoneApp, queryClient, toast])
  const canFile = (action: FileAction) => tree(DOCUMENT_MAKER_NODE, TREE_ACTION[action]) && !(inPhoneApp && (action === 'office' || action === 'libreOffice'))
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('edited-desc')
  const [filter, setFilter] = useState<Filter>('all')
  const [renaming, setRenaming] = useState<MakerDocument | null>(null)
  const [deleting, setDeleting] = useState<MakerDocument | null>(null)
  const [sharing, setSharing] = useState<MakerDocument | null>(null)
  const [history, setHistory] = useState<MakerDocument | null>(null)
  const [scope, setScope] = useState<Scope>('all')
  const picker = useRef<HTMLInputElement>(null)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (files.data ?? [])
      .filter((doc) => (filter === 'all' || doc.kind === filter) && (!needle || doc.title.toLowerCase().includes(needle)))
      .filter((doc) => scope === 'all' || (scope === 'shared') === !!doc.permissions)
      .sort(SORTS[sort])
  }, [files.data, query, sort, filter, scope])
  const hasShared = (files.data ?? []).some((doc) => doc.permissions)

  const openInApp = async (doc: MakerDocument) => {
    try { await openMakerDocumentInApp(doc) } catch (error) { toast(message(error, 'Could not open the file.'), undefined, 'error') }
  }

  const openInDesktop = async (doc: MakerDocument, app: DesktopApp) => {
    try {
      await openMakerDocumentInDesktopApp(doc, app)
      toast(`Opening "${doc.title}" in ${APP_LABELS[app]}. Every save there is kept here as a new version.`)
    } catch (error) { toast(message(error, 'Could not open the file.'), undefined, 'error') }
  }
  /** Card or row click: the installed Word / Excel / PowerPoint (the phone's app in the Android app). */
  const openFile = (doc: MakerDocument) => (inPhoneApp ? openInApp(doc) : openInDesktop(doc, 'office'))

  const startNew = async (kind: MakerDocumentKind) => {
    let doc: MakerDocument
    try {
      doc = await create.mutateAsync({ kind, title: `Untitled ${KIND_LABELS[kind].toLowerCase()}`, owner })
    } catch (error) { toast(message(error, 'Could not create the file.'), undefined, 'error'); return }
    await openFile(doc)
  }

  const uploadFile = async (file: File) => {
    if (file.size > MAKER_LIMITS.uploadBytes) { toast('Choose a file smaller than 5 MB.', undefined, 'error'); return }
    try {
      const doc = await upload.mutateAsync({ name: file.name, data: await readFileBase64(file), owner })
      toast(`Uploaded "${doc.title}".`)
    } catch (error) { toast(message(error, 'Could not upload the file.'), undefined, 'error') }
  }

  const onAction = async (action: FileAction, doc: MakerDocument) => {
    if (action === 'rename') setRenaming(doc)
    else if (action === 'delete') setDeleting(doc)
    else if (action === 'share') setSharing(doc)
    else if (action === 'versions') setHistory(doc)
    else if (action === 'office' || action === 'libreOffice') await openInDesktop(doc, action)
    else if (action === 'duplicate') {
      try { await duplicate.mutateAsync(doc.id); toast(`Duplicated "${doc.title}".`) } catch (error) { toast(message(error, 'Could not duplicate the file.'), undefined, 'error') }
    } else {
      try { await downloadMakerDocument(doc) } catch (error) { toast(message(error, 'Could not download the file.'), undefined, 'error') }
    }
  }

  const total = files.data?.length ?? 0
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] font-semibold tracking-tight text-ink-900">Document maker</h1>
            <p className="mt-1 max-w-xl text-[13px] text-muted">
              {inPhoneApp
                ? 'Word, Excel and PowerPoint files saved on this phone. Tap a file to edit it in an app on your phone.'
                : 'Word, Excel and PowerPoint files. Click one to edit it in Microsoft Office on this computer; every save is kept here.'}
            </p>
          </div>
          <span className="rounded-full bg-panel px-3 py-1 text-[12px] font-medium tabular-nums text-muted">{total} {total === 1 ? 'file' : 'files'}</span>
        </header>

        <DriveStrip />
        {tree(DOCUMENT_MAKER_NODE, 'create') && <NewFileTiles onCreate={(kind) => void startNew(kind)} onUpload={() => picker.current?.click()} busy={create.isPending || upload.isPending} />}
        <input
          ref={picker} type="file" className="hidden" aria-label="Office file to upload"
          accept=".docx,.xlsx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); event.target.value = '' }}
        />

        <section aria-labelledby="dm-files-heading" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="dm-files-heading" className="mr-auto text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Your files</h2>
            {hasShared && (
              <div role="radiogroup" aria-label="Whose files" className="neu-inset flex rounded-lg p-0.5">
                {(Object.keys(SCOPE_LABELS) as Scope[]).map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={scope === value} onClick={() => setScope(value)}
                    className={cn('h-8 rounded-md px-2.5 text-[12px] font-medium transition-colors focus-visible:focus-ring',
                      scope === value ? 'bg-white text-ink-900 shadow-sm' : 'text-muted hover:text-ink')}>
                    {SCOPE_LABELS[value]}
                  </button>
                ))}
              </div>
            )}
            <div role="radiogroup" aria-label="File type" className="neu-inset flex rounded-lg p-0.5">
              {(['all', ...MAKER_KIND_ORDER] as Filter[]).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={filter === value} onClick={() => setFilter(value)}
                  className={cn('h-8 rounded-md px-2.5 text-[12px] font-medium transition-colors focus-visible:focus-ring',
                    filter === value ? 'bg-white text-ink-900 shadow-sm' : 'text-muted hover:text-ink')}>
                  {value === 'all' ? 'All' : `${KIND_LABELS[value]}s`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[12rem] flex-1">
              <span className="sr-only">Search files</span>
              <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted/70 focus:border-ink-600 focus-visible:focus-ring" />
            </label>
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <Icon name="ArrowDownUp" size={14} />
              <span className="sr-only">Sort</span>
              <select aria-label="Sort files" value={sort} onChange={(event) => setSort(event.target.value as Sort)}
                className="h-10 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring">
                <option value="edited-desc">Last edited (newest)</option>
                <option value="edited-asc">Last edited (oldest)</option>
                <option value="name">Name (A–Z)</option>
              </select>
            </label>
          </div>

          {files.isLoading && <div role="status" className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-muted">Loading your files…</div>}
          {files.isError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-crimson/30 bg-crimson-100 p-4 text-sm text-crimson">
              {message(files.error, 'Could not load your files.')}
              <Button size="sm" onClick={() => void files.refetch()}>Retry</Button>
            </div>
          )}
          {files.isSuccess && total === 0 && (
            <div className="neu-inset flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-ink-700 shadow-sm"><Icon name="FilePenLine" size={22} /></span>
              <p className="text-[15px] font-semibold text-ink-900">No files yet</p>
              <p className="max-w-sm text-[13px] text-muted">Start a document, spreadsheet or presentation above, or upload one you already have.</p>
            </div>
          )}
          {files.isSuccess && total > 0 && visible.length === 0 && (
            <p className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-muted">No files match “{query}”.</p>
          )}
          {visible.length > 0 && <FileList files={visible} can={canFile} onAction={(action, doc) => void onAction(action, doc)} onOpen={(doc) => void openFile(doc)} />}
        </section>
      </div>

      <ShareDialog doc={sharing} onClose={() => setSharing(null)} />
      <VersionsDialog doc={history} onClose={() => setHistory(null)} />
      <RenameDialog doc={renaming} onClose={() => setRenaming(null)} onRename={async (title) => { if (renaming) await rename.mutateAsync({ id: renaming.id, title }) }} />
      <ConfirmDeleteDialog
        open={!!deleting} onClose={() => setDeleting(null)} itemLabel={deleting?.title ?? ''}
        onConfirm={async () => { if (deleting) await remove.mutateAsync(deleting.id) }}
      />
    </div>
  )
}

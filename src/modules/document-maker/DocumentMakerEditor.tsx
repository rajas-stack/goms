import { useEffect, useId, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { repository } from '@/data/repository'
import { MakerEditorUnavailable, type MakerEditorSession } from '@/data/in-memory/makerDocuments'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { downloadMakerDocument, useMakerDocuments } from './api'
import { DocumentServerUnreachable, loadDocsApi } from './docsApi'
import { EditorNotice, SETUP_DOC } from './EditorNotice'
import { editedLabel, KIND_META } from './kinds'
import { useHtmlTheme } from './useHtmlTheme'

/** When the build pins a Document Server (VITE_ONLYOFFICE_URL), never load api.js from any other origin. */
function isExpectedServer(url: string): boolean {
  const pinned = import.meta.env.VITE_ONLYOFFICE_URL as string | undefined
  if (!pinned) return true
  try { return new URL(url).origin === new URL(pinned).origin } catch { return false }
}

type FrameState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'unreachable'; url: string } | { kind: 'failed'; message: string }

/** /document-maker/:id — the ONLYOFFICE editor for one file, full height under a slim header. */
export function DocumentMakerEditor() {
  const { id = '' } = useParams()
  const theme = useHtmlTheme()
  const toast = useToast()
  const containerId = `dm-editor-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const files = useMakerDocuments()
  const doc = files.data?.find((item) => item.id === id)
  const session = useQuery({
    queryKey: ['makerEditor', id, theme],
    queryFn: () => repository.getMakerEditorSession(id, theme),
    retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false,
  })
  const [frame, setFrame] = useState<FrameState>({ kind: 'loading' })

  useEffect(() => {
    const data = session.data
    if (!data) return
    let cancelled = false
    let editor: { destroyEditor: () => void } | null = null
    if (!isExpectedServer(data.documentServerUrl)) {
      setFrame({ kind: 'failed', message: `The API pointed the editor at ${data.documentServerUrl}, which is not this build's VITE_ONLYOFFICE_URL.` })
      return
    }
    setFrame({ kind: 'loading' })
    loadDocsApi(data.documentServerUrl).then((api) => {
      if (cancelled) return
      editor = new api.DocEditor(containerId, {
        ...data.config,
        events: {
          onDocumentReady: () => setFrame({ kind: 'ready' }),
          onError: (event: { data?: { errorDescription?: string } }) => setFrame({ kind: 'failed', message: event.data?.errorDescription ?? 'The editor reported an error.' }),
        },
      })
      setFrame((current) => (current.kind === 'loading' ? { kind: 'ready' } : current))
    }).catch((error: unknown) => {
      if (cancelled) return
      setFrame(error instanceof DocumentServerUnreachable ? { kind: 'unreachable', url: error.serverUrl } : { kind: 'failed', message: 'The editor could not start.' })
    })
    return () => { cancelled = true; editor?.destroyEditor() }
  }, [session.data, containerId])

  const meta = doc ? KIND_META[doc.kind] : null
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-paper px-3 py-1.5 sm:px-4">
        <Link to="/document-maker" aria-label="Back to all files" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-ink-900/[0.06] hover:text-ink focus-visible:focus-ring">
          <Icon name="ArrowLeft" size={17} />
        </Link>
        {meta && <span aria-hidden className={cn('flex h-7 w-7 items-center justify-center rounded-md', meta.tint, meta.text)}><Icon name={meta.icon} size={15} /></span>}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold text-ink-900">{doc?.title ?? (files.isLoading ? 'Loading…' : 'File')}</h1>
          {doc && <p className="truncate text-[11px] text-muted">.{doc.fileType} · version {doc.version} · edited {editedLabel(doc.updatedAt).toLowerCase()}{frame.kind === 'ready' && ' · changes save automatically'}</p>}
        </div>
        {doc && (
          <Button size="sm" onClick={() => { downloadMakerDocument(doc).catch((error: unknown) => toast(error instanceof Error ? error.message : 'Could not download the file.', undefined, 'error')) }}>
            <Icon name="Download" size={14} /><span className="hidden sm:inline">Download</span>
          </Button>
        )}
      </header>
      <div className="relative min-h-0 flex-1 bg-panel">
        <EditorBody session={session} frame={frame} />
        {/* DocsAPI replaces this element with its iframe; it must exist before the editor is created. */}
        <div className={cn('absolute inset-0', (!session.data || frame.kind === 'unreachable' || frame.kind === 'failed') && 'invisible')}>
          <div id={containerId} className="h-full w-full" />
        </div>
      </div>
    </div>
  )
}

function EditorBody({ session, frame }: { session: UseQueryResult<MakerEditorSession>; frame: FrameState }) {
  const back = <Link to="/document-maker" className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-panel focus-visible:focus-ring"><Icon name="ArrowLeft" size={14} /> All files</Link>
  if (session.isLoading || (session.data && frame.kind === 'loading')) {
    return <div role="status" className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-muted"><Icon name="Loader" size={16} className="animate-spin" /> Opening the editor…</div>
  }
  if (session.error instanceof MakerEditorUnavailable) {
    return <EditorNotice icon="ServerOff" title="Editing needs the GOMS server" actions={back}>
      <p>This build keeps files on this device only (no <code className="font-mono text-ink">VITE_API_BASE_URL</code>), and the ONLYOFFICE Document Server can only open files it can download from the GOMS API.</p>
      <p>You can still create, upload, rename, duplicate, download and delete files here. See <code className="font-mono text-ink">{SETUP_DOC}</code> to enable editing.</p>
    </EditorNotice>
  }
  if (session.error) {
    return <EditorNotice icon="TriangleAlert" title="The editor is not available" actions={<>{back}<Button size="sm" onClick={() => void session.refetch()}>Try again</Button></>}>
      <p>{session.error instanceof Error ? session.error.message : 'Could not open this file.'}</p>
      <p>Setup steps are in <code className="font-mono text-ink">{SETUP_DOC}</code>.</p>
    </EditorNotice>
  }
  if (frame.kind === 'unreachable') {
    return <EditorNotice icon="ServerOff" title="ONLYOFFICE server not running" actions={<>{back}<Button size="sm" onClick={() => window.location.reload()}>Retry</Button></>}>
      <p>The Document Server at <code className="break-all font-mono text-ink">{frame.url}</code> did not respond, so this file cannot be opened right now.</p>
      <p>Start it (see <code className="font-mono text-ink">{SETUP_DOC}</code>) and retry. Your file is safe.</p>
    </EditorNotice>
  }
  if (frame.kind === 'failed') {
    return <EditorNotice icon="TriangleAlert" title="The editor stopped" actions={back}><p>{frame.message}</p></EditorNotice>
  }
  return null
}

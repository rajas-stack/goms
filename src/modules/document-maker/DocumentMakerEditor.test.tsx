import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { MakerEditorUnavailable } from '@/data/in-memory/makerDocuments'

const repo = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/data/repository', () => ({ get repository() { return repo.current } }))
import { makeMakerRepository } from './testRepository'
import { DocumentMakerEditor } from './DocumentMakerEditor'
import { DOCS_API_PATH } from './docsApi'

let serverCount = 0
const session = (serverUrl: string) => ({
  documentServerUrl: serverUrl,
  config: { token: 'signed', documentType: 'word', document: { key: 'k-v1', title: 'Plan.docx' }, editorConfig: { lang: 'en' } },
})

async function renderEditor() {
  const doc = await repo.current.createMakerDocument({ kind: 'document', title: 'Plan' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/document-maker/${doc.id}`]}>
          <Routes><Route path="/document-maker/:id" element={<DocumentMakerEditor />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { doc, ...view }
}

describe('Document maker editor page', () => {
  beforeEach(() => { repo.current = makeMakerRepository(); delete window.DocsAPI })
  afterEach(() => { delete window.DocsAPI; document.documentElement.classList.remove('dark'); document.head.querySelectorAll('script').forEach((s) => s.remove()) })

  it('explains that offline builds cannot edit', async () => {
    repo.current.getMakerEditorSession.mockRejectedValue(new MakerEditorUnavailable())
    await renderEditor()
    expect(await screen.findByText('Editing needs the GOMS server')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
  })

  it('creates the ONLYOFFICE editor with the signed config and destroys it on leave', async () => {
    const destroyEditor = vi.fn()
    const DocEditor = vi.fn(function () { return { destroyEditor } })
    window.DocsAPI = { DocEditor: DocEditor as any }
    repo.current.getMakerEditorSession.mockResolvedValue(session('http://ds-ready'))
    const { doc, unmount } = await renderEditor()
    await waitFor(() => expect(DocEditor).toHaveBeenCalledOnce())
    expect(repo.current.getMakerEditorSession).toHaveBeenCalledWith(doc.id, 'light')
    const [containerId, config] = DocEditor.mock.calls[0] as unknown as [string, Record<string, any>]
    expect(document.getElementById(containerId)).not.toBeNull()
    expect(config).toMatchObject({ token: 'signed', documentType: 'word', document: { key: 'k-v1' } })
    expect(typeof config.events.onDocumentReady).toBe('function')
    unmount()
    expect(destroyEditor).toHaveBeenCalledOnce()
  })

  it('loads api.js from the Document Server and reports when it is not running', async () => {
    const server = `http://ds-down-${++serverCount}`
    repo.current.getMakerEditorSession.mockResolvedValue(session(server))
    await renderEditor()
    let script: HTMLScriptElement | null = null
    await waitFor(() => { script = document.head.querySelector(`script[src="${server}${DOCS_API_PATH}"]`); expect(script).not.toBeNull() })
    act(() => { script!.dispatchEvent(new Event('error')) })
    expect(await screen.findByText('ONLYOFFICE server not running')).toBeInTheDocument()
    expect(screen.getByText(server)).toBeInTheDocument()
  })

  it('refuses to load api.js from a server other than the pinned VITE_ONLYOFFICE_URL', async () => {
    vi.stubEnv('VITE_ONLYOFFICE_URL', 'http://localhost:8082')
    repo.current.getMakerEditorSession.mockResolvedValue(session('http://evil.example'))
    await renderEditor()
    expect(await screen.findByText(/not this build's VITE_ONLYOFFICE_URL/)).toBeInTheDocument()
    expect(document.head.querySelector('script[src^="http://evil.example"]')).toBeNull()
    vi.unstubAllEnvs()
  })

  it('shows the server message when the API refuses (e.g. not configured)', async () => {
    repo.current.getMakerEditorSession.mockRejectedValue(new Error('The document editor is not set up: ONLYOFFICE_JWT_SECRET is not set.'))
    await renderEditor()
    expect(await screen.findByText(/ONLYOFFICE_JWT_SECRET is not set/)).toBeInTheDocument()
  })

  it('asks for a dark-themed editor when the app switches to dark', async () => {
    window.DocsAPI = { DocEditor: vi.fn(function () { return { destroyEditor: vi.fn() } }) as any }
    repo.current.getMakerEditorSession.mockResolvedValue(session('http://ds-theme'))
    const { doc } = await renderEditor()
    await waitFor(() => expect(repo.current.getMakerEditorSession).toHaveBeenCalledWith(doc.id, 'light'))
    act(() => { document.documentElement.classList.add('dark') })
    await waitFor(() => expect(repo.current.getMakerEditorSession).toHaveBeenCalledWith(doc.id, 'dark'))
  })
})

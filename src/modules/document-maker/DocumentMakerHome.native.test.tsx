import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MIME_FOR_FILE_TYPE } from '@goms/domain'
import { ToastProvider } from '@/components/ui/Toast'

// Inside the Android app: no in-app editor, files open in a phone app.
const repo = vi.hoisted(() => ({ current: null as any }))
const openFileInApp = vi.hoisted(() => vi.fn(async () => 'file:///phone/Untitled document.docx'))
// The phone's copy of the file: its last-modified time and contents, as the Filesystem plugin reports them.
const phoneFile = vi.hoisted(() => ({ mtime: 1, data: 'UEsDBA==' }))
const resume = vi.hoisted(() => ({ current: null as null | ((state: { isActive: boolean }) => void) }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {
  stat: vi.fn(async () => ({ mtime: phoneFile.mtime })),
  readFile: vi.fn(async () => ({ data: phoneFile.data })),
} }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async (_event: string, cb: (state: { isActive: boolean }) => void) => {
  resume.current = cb
  return { remove: vi.fn() }
}) } }))
vi.mock('@/data/repository', () => ({ get repository() { return repo.current } }))
vi.mock('@capacitor/core', async (original) => {
  const actual = await original<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true } }
})
vi.mock('@/lib/file-export', () => ({ openFileInApp, downloadBinaryFile: vi.fn() }))
import { makeMakerRepository } from './testRepository'
import { DocumentMakerHome } from './DocumentMakerHome'

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/document-maker']}>
          <Routes>
            <Route path="/document-maker" element={<DocumentMakerHome />} />
            <Route path="/document-maker/:id" element={<p>in-app editor</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Document maker home in the Android app', () => {
  beforeEach(() => {
    openFileInApp.mockClear()
    phoneFile.mtime = 1
    phoneFile.data = 'UEsDBA=='
    repo.current = makeMakerRepository()
    repo.current.getMakerDownload.mockImplementation(async () => ({ url: 'data:application/octet-stream;base64,UEsDBA==', name: 'Untitled document.docx' }))
  })

  it('creates a file and hands it to a phone app instead of the in-app editor', async () => {
    renderHome()
    await screen.findByText('No files yet')
    await userEvent.click(screen.getByRole('button', { name: 'New document' }))
    await waitFor(() => expect(openFileInApp).toHaveBeenCalledWith('Untitled document.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04]), MIME_FOR_FILE_TYPE.docx))
    expect(screen.queryByText('in-app editor')).not.toBeInTheDocument()
  })

  it('opens a listed file in a phone app when tapped', async () => {
    await repo.current.createMakerDocument({ kind: 'document', title: 'Tender reply' })
    renderHome()
    await userEvent.click(await screen.findByRole('button', { name: 'Tender reply' }))
    await waitFor(() => expect(openFileInApp).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('in-app editor')).not.toBeInTheDocument()
  })

  it('saves what the phone app saved as a new version when GOMS comes back, and nothing when it is unchanged', async () => {
    const doc = await repo.current.createMakerDocument({ kind: 'document', title: 'Tender reply' })
    renderHome()
    await userEvent.click(await screen.findByRole('button', { name: 'Tender reply' }))
    await waitFor(() => expect(openFileInApp).toHaveBeenCalledTimes(1))

    await act(async () => { resume.current?.({ isActive: true }) })
    expect(repo.current.replaceMakerDocument).not.toHaveBeenCalled()

    phoneFile.mtime = 2
    phoneFile.data = 'UEsDBAE='
    await act(async () => { resume.current?.({ isActive: true }) })
    await waitFor(() => expect(repo.current.replaceMakerDocument).toHaveBeenCalledWith(doc.id, 'Untitled document.docx', 'UEsDBAE='))
    expect(await screen.findByText(/as a new version/)).toBeInTheDocument()

    await act(async () => { resume.current?.({ isActive: true }) }) // already uploaded
    // Files opened by the earlier tests are watched too (module state), so count this file's uploads only.
    expect(repo.current.replaceMakerDocument.mock.calls.filter(([id]: [string]) => id === doc.id)).toHaveLength(1)
  })
})

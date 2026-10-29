import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MIME_FOR_FILE_TYPE } from '@goms/domain'
import { ToastProvider } from '@/components/ui/Toast'

// Inside the Android app: no in-app editor, files open in a phone app.
const repo = vi.hoisted(() => ({ current: null as any }))
const openFileInApp = vi.hoisted(() => vi.fn(async () => {}))
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
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'

const repo = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/data/repository', () => ({ get repository() { return repo.current } }))
const desktop = vi.hoisted(() => ({ open: vi.fn(async () => undefined) }))
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), openMakerDocumentInDesktopApp: desktop.open }))
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
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** The file name is the first button in a row (the other is its Actions menu). */
const titleButton = (row: HTMLElement) => within(row).queryAllByRole('button').find((b) => !b.getAttribute('aria-label')?.startsWith('Actions for'))
const rows = () => screen.getAllByRole('row').filter((row) => titleButton(row))
const rowTitles = () => rows().map((row) => titleButton(row)!.textContent)

async function openActions(title: string) {
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${title}` }))
}

describe('Document maker home', () => {
  beforeEach(() => { repo.current = makeMakerRepository(); desktop.open.mockClear() })

  it('shows the empty state and the three New tiles', async () => {
    renderHome()
    expect(await screen.findByText('No files yet')).toBeInTheDocument()
    for (const name of ['New document', 'New spreadsheet', 'New presentation']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
  })

  it('creates a blank file and opens it in the installed Office app', async () => {
    renderHome()
    await screen.findByText('No files yet')
    await userEvent.click(screen.getByRole('button', { name: 'New presentation' }))
    expect(repo.current.createMakerDocument).toHaveBeenCalledWith(expect.objectContaining({ kind: 'presentation', title: 'Untitled presentation' }))
    await waitFor(() => expect(desktop.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'presentation' }), 'office'))
  })

  it('opens an existing file in the installed Office app when its name is clicked', async () => {
    await repo.current.createMakerDocument({ kind: 'document', title: 'Tender reply' })
    renderHome()
    await waitFor(() => expect(rowTitles()).toEqual(['Tender reply']))
    await userEvent.click(titleButton(rows()[0])!)
    expect(desktop.open).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tender reply' }), 'office')
  })

  it('lists files with owner, searches and filters by type', async () => {
    await repo.current.createMakerDocument({ kind: 'document', title: 'Tender reply' })
    await repo.current.createMakerDocument({ kind: 'spreadsheet', title: 'Budget' })
    renderHome()
    await waitFor(() => expect(rowTitles()).toEqual(['Budget', 'Tender reply']))
    expect(within(rows()[0]).getByText('This device')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('Search by name'), 'tend')
    expect(rowTitles()).toEqual(['Tender reply'])
    await userEvent.clear(screen.getByPlaceholderText('Search by name'))
    await userEvent.click(screen.getByRole('radio', { name: 'Spreadsheets' }))
    expect(rowTitles()).toEqual(['Budget'])
  })

  it('sorts by name', async () => {
    await repo.current.createMakerDocument({ kind: 'document', title: 'Alpha' })
    await repo.current.createMakerDocument({ kind: 'document', title: 'Zulu' })
    renderHome()
    await waitFor(() => expect(rowTitles()).toEqual(['Zulu', 'Alpha']))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort files' }), 'name')
    expect(rowTitles()).toEqual(['Alpha', 'Zulu'])
  })

  it('renames, duplicates and deletes (after confirming)', async () => {
    await repo.current.createMakerDocument({ kind: 'document', title: 'Draft' })
    renderHome()
    await waitFor(() => expect(rowTitles()).toEqual(['Draft']))

    await openActions('Draft')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = await screen.findByLabelText('Name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Final{Enter}')
    await waitFor(() => expect(rowTitles()).toEqual(['Final']))

    await openActions('Final')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    await waitFor(() => expect(rowTitles()).toEqual(['Copy of Final', 'Final']))

    await openActions('Copy of Final')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(repo.current.deleteMakerDocument).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(rowTitles()).toEqual(['Final']))
  })
})

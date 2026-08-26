import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { adminImportApi } from './api'
import { GeographyLoadPanel } from './GeographyLoadPanel'

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <GeographyLoadPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const LOAD_BUTTON = /load\/update official geography dataset/i

describe('GeographyLoadPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows reconciliation counts and disables Commit when reconciliation does not match', async () => {
    vi.spyOn(adminImportApi, 'previewGeographyLoad').mockResolvedValue({
      summary: { toCreate: 100, toUpdate: 0, unchanged: 0, rejected: 0, total: 100 },
      reconciliation: { sourceRowCount: 101, classifiedRowCount: 100, matches: false },
      commitToken: 'abc',
    } as any)

    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: LOAD_BUTTON }))

    expect(await screen.findByText(/reconciliation mismatch/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm commit/i })).toBeDisabled()
  })

  it('enables Commit and shows counts when reconciliation matches', async () => {
    vi.spyOn(adminImportApi, 'previewGeographyLoad').mockResolvedValue({
      summary: { toCreate: 7178, toUpdate: 0, unchanged: 0, rejected: 0, total: 7178 },
      reconciliation: { sourceRowCount: 7178, classifiedRowCount: 7178, matches: true },
      commitToken: 'abc',
    } as any)

    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: LOAD_BUTTON }))

    expect(await screen.findByText(/7178 to create/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm commit/i })).toBeEnabled()
  })

  it('commits with the preview\'s token and then shows the result summary', async () => {
    vi.spyOn(adminImportApi, 'previewGeographyLoad').mockResolvedValue({
      summary: { toCreate: 7178, toUpdate: 0, unchanged: 0, rejected: 0, total: 7178 },
      reconciliation: { sourceRowCount: 7178, classifiedRowCount: 7178, matches: true },
      commitToken: 'abc',
    } as any)
    const commit = vi.spyOn(adminImportApi, 'commitGeographyLoad').mockResolvedValue({
      summary: { toCreate: 7178, toUpdate: 0, unchanged: 0, rejected: 0, total: 7178 },
    } as any)

    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: LOAD_BUTTON }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm commit/i }))

    expect(await screen.findByText(/7178 created/i)).toBeInTheDocument()
    expect(commit).toHaveBeenCalledWith({ commitToken: 'abc' })
  })

  it('shows no per-row grid — 7,000+ rows is not a reviewable spreadsheet', async () => {
    vi.spyOn(adminImportApi, 'previewGeographyLoad').mockResolvedValue({
      summary: { toCreate: 7178, toUpdate: 0, unchanged: 0, rejected: 0, total: 7178 },
      reconciliation: { sourceRowCount: 7178, classifiedRowCount: 7178, matches: true },
      commitToken: 'abc',
    } as any)

    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: LOAD_BUTTON }))

    await screen.findByText(/7178 to create/i)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('reports a failed commit as a rolled-back failure, not a partial success', async () => {
    vi.spyOn(adminImportApi, 'previewGeographyLoad').mockResolvedValue({
      summary: { toCreate: 7178, toUpdate: 0, unchanged: 0, rejected: 0, total: 7178 },
      reconciliation: { sourceRowCount: 7178, classifiedRowCount: 7178, matches: true },
      commitToken: 'abc',
    } as any)
    vi.spyOn(adminImportApi, 'commitGeographyLoad').mockRejectedValue(new Error('Reconciliation mismatch: refusing to commit.'))

    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: LOAD_BUTTON }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm commit/i }))

    expect(await screen.findByText(/nothing was written/i)).toBeInTheDocument()
  })
})

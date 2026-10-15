import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SynopsisGrid } from '@goms/domain'
import { repository, resetLocalData } from '@/data/repository'
import { gridDocument, readGridSection } from '../gridIO'
import { GridTab } from '../GridTab'

const grid: SynopsisGrid = {
  columns: [{ id: 'cName', name: 'Criteria', type: 'text' }, { id: 'cReq', name: 'Requirement', type: 'text' }],
  rows: [
    { id: 'r1', cells: { cName: 'Turnover', cReq: 'Average turnover of 100 Crore' } },
    { id: 'r2', cells: { cName: 'Experience', cReq: '3 similar projects' } },
  ],
}

async function setupBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Parking' })
  const bid = await repository.createBid(opp.id)
  await repository.saveBidSynopsis({ bidId: bid.id, section: 'pq', document: gridDocument(grid, ''), expectedRevision: 0 })
  return bid
}
function renderTab(bidId: string) {
  sessionStorage.clear()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><GridTab bidId={bidId} section="pq" /></QueryClientProvider>)
}

describe('grid corrigendum comparison columns', () => {
  beforeEach(() => resetLocalData())

  it('shows a read-only After C1 column next to the changed column, blank where unchanged, and can hide it', async () => {
    const bid = await setupBid()
    await repository.createBidCorrigendum({ bidId: bid.id, corrigendumNumber: 1, changes: [{
      fieldKey: 'grid:pq:r1:cReq', currentValue: 'Average turnover of 100 Crore', proposedValue: 'Average turnover of 75 Crore',
      kind: 'clause', clauseTitle: 'Turnover', affectedModule: 'pq',
    }] })
    renderTab(bid.id)
    expect(await screen.findByText('Requirement · After C1')).toBeInTheDocument()
    const changed = screen.getByRole('button', { name: /Row 1, Requirement: changed by C1/ })
    expect(within(changed).getByText('75')).toHaveAttribute('data-diff', 'added')
    expect(document.querySelectorAll('[data-after-cell="same"]')).toHaveLength(1)
    // Derived only: nothing about it is saved into the grid.
    expect(JSON.stringify(readGridSection((await repository.getBidSynopsis(bid.id, 'pq'))!.document).grid)).not.toContain('75')

    await userEvent.click(changed)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Original tender')

    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Show corrigendum changes \(1\)/ }))
    expect(screen.queryByText('Requirement · After C1')).not.toBeInTheDocument()
  })

  it('records a corrigendum change from a cell, pre-filled and added to the chosen corrigendum', async () => {
    const bid = await setupBid()
    await repository.createBidCorrigendum({ bidId: bid.id, corrigendumNumber: 1, changes: [{
      fieldKey: 'pq.other', currentValue: 'a', proposedValue: 'b', kind: 'clause', clauseTitle: 'Other', affectedModule: 'pq',
    }] })
    renderTab(bid.id)
    await screen.findByText('3 similar projects')
    fireEvent.contextMenu(document.querySelector('[data-pos="1:1"]')!)
    await userEvent.click(within(screen.getByTestId('grid-context-menu')).getByRole('menuitem', { name: 'Record corrigendum change…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('linked-cell')).toHaveTextContent('PQ › Experience › Requirement')
    expect(within(dialog).getByLabelText('Clause title 1')).toHaveValue('Experience — Requirement')
    expect(within(dialog).getByLabelText('Original clause 1')).toHaveValue('3 similar projects')
    expect(within(dialog).getByLabelText('Corrigendum')).toHaveDisplayValue(/CORRIGENDUM 01/)
    await userEvent.type(within(dialog).getByLabelText('Modified clause 1'), '2 similar projects')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to C1' }))
    await waitFor(() => expect(screen.getByText('Requirement · After C1')).toBeInTheDocument())
    const [c1] = await repository.listBidCorrigenda(bid.id)
    expect(c1.changes.find((c) => c.fieldKey === 'grid:pq:r2:cReq')).toMatchObject({ currentValue: '3 similar projects', proposedValue: '2 similar projects', affectedModule: 'pq' })
  })
})

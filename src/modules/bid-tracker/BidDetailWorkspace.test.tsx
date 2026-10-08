import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { repository, resetLocalData } from '@/data/repository'
import { BidDetailWorkspace } from './BidDetailWorkspace'
import { generalToDocument } from './synopsis/generalFields'

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/bid-tracker/bid/:bidId" element={<BidDetailWorkspace />} />
          <Route path="/bid-tracker" element={<div>grid page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', city: 'Pune', submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}

describe('BidDetailWorkspace', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('renders the header, ten synopsis tabs and the Overview by default', async () => {
    const bid = await makeBid()
    renderAt(`/bid-tracker/bid/${bid.id}`)
    expect(await screen.findByRole('heading', { name: 'Smart Bus' })).toBeInTheDocument()
    // The internal bid code is noise here; the opportunity ID identifies the bid.
    expect(screen.queryByText(bid.bidCode)).not.toBeInTheDocument()
    expect(screen.getByText('Pune', { exact: false })).toBeInTheDocument()
    for (const tab of ['Overview', 'General', 'Scope of Work', 'PQ', 'TQ', 'Manpower', 'Milestone', 'Payment Terms', 'BoQ', 'Queries', 'RFP Timeline']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument()
    }
    expect(screen.queryByRole('tab', { name: 'Commercial & Files' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Protected Values' })).not.toBeInTheDocument()
    // Requirements are stage guidance, not a claim that evidence was submitted.
    expect(screen.getByText(/Finalize technical solution; Submit pre-bid queries/)).toBeInTheDocument()
    expect(screen.getByText(/completion or submission is not verified here/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Submission Deadline — 2099-01-15/)).toBeInTheDocument())
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('shows the resolved owner, marking an inherited one', async () => {
    const bid = await makeBid()
    const person = await repository.createSalesPerson({ name: 'Asha Rao', officialEmail: 'asha@amnex.com', designation: 'RM', tierKey: 'rm' })
    await repository.assignOwner({ entityType: 'opportunity', entityId: bid.opportunityId, salesPersonId: person.id, startDate: '2020-01-01' })
    renderAt(`/bid-tracker/bid/${bid.id}`)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('(inherited)')).toBeInTheDocument()
  })

  it('archives, restores and deletes the bid from its header, returning to the grid', async () => {
    const bid = await makeBid()
    renderAt(`/bid-tracker/bid/${bid.id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Archive/ }))
    expect(await screen.findByText('Archived')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Restore/ }))
    await waitFor(() => expect(screen.queryByText('Archived')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Delete bid/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('grid page')).toBeInTheDocument()
    expect(await repository.getBid(bid.id)).toBeFalsy()
  })

  it('links back to the Master Grid, and says so for a bid that no longer exists', async () => {
    renderAt('/bid-tracker/bid/nope')
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Back to the Master Grid' }))
    expect(await screen.findByText('grid page')).toBeInTheDocument()
  })

  it('edits and saves General tender information as typed fields', async () => {
    const bid = await makeBid()
    renderAt(`/bid-tracker/bid/${bid.id}?tab=general`)
    const tenderId = await screen.findByLabelText('Tender ID')
    await userEvent.type(tenderId, '2026_PPAC_927042_1')
    // Dates accept free-format text ("13th May 2026") and are stored as yyyy-mm-dd.
    await userEvent.type(screen.getByLabelText('Tender Publishing Date'), '13th May 2026')
    await userEvent.selectOptions(screen.getByLabelText('PQ Compliance'), 'not complied')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    const saved = await repository.getBidSynopsis(bid.id, 'general')
    expect(saved?.revision).toBe(1)
    expect(JSON.stringify(saved?.document)).toContain('2026_PPAC_927042_1')
    expect(JSON.stringify(saved?.document)).toContain('2026-05-13')
    expect(JSON.stringify(saved?.document)).toContain('not complied')
    // Saved information is locked until Edit is clicked.
    expect(screen.queryByLabelText('Tender ID')).not.toBeInTheDocument()
    expect(screen.getByText('2026_PPAC_927042_1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }))
    expect(screen.getByLabelText('Tender ID')).toHaveValue('2026_PPAC_927042_1')
  })

  it('opens saved General locked, and Cancel reverts unsaved edits', async () => {
    const bid = await makeBid()
    await repository.saveBidSynopsis({ bidId: bid.id, section: 'general', document: generalToDocument({ tenderId: 'T-1' }), expectedRevision: 0 })
    renderAt(`/bid-tracker/bid/${bid.id}?tab=general`)
    expect(await screen.findByText('T-1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tender ID')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }))
    await userEvent.clear(screen.getByLabelText('Tender ID'))
    await userEvent.type(screen.getByLabelText('Tender ID'), 'T-2')
    await userEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(screen.getByText('T-1')).toBeInTheDocument()
    expect(screen.queryByText('T-2')).not.toBeInTheDocument()
  })

  it('picks Procuring Authority from Account Mapping and tender websites from Settings', async () => {
    const [dept] = await repository.listDepartments()
    await repository.createTenderWebsite({ name: 'E-Proc', url: 'https://eproc.example.gov.in' })
    const bid = await makeBid()
    await repository.saveBidSynopsis({ bidId: bid.id, section: 'general', expectedRevision: 0, document: generalToDocument({ procuringAuthority: 'Old free text authority' }) })
    renderAt(`/bid-tracker/bid/${bid.id}?tab=general`)
    expect(await screen.findByText('Old free text authority')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }))
    // The legacy value is kept and shown until a department is picked.
    const authority = screen.getByRole('combobox', { name: 'Procuring Authority' })
    expect(authority).toHaveValue('Old free text authority')
    await userEvent.click(authority)
    await userEvent.type(authority, dept.name)
    await userEvent.click((await screen.findAllByRole('option', { name: new RegExp(dept.name) }))[0])

    const websites = screen.getByRole('group', { name: /Websites for downloading/ })
    await userEvent.click(within(websites).getByRole('button', { name: /Choose websites/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'E-Proc' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /Save/ }))

    const link = await screen.findByRole('link', { name: /E-Proc/ })
    expect(link).toHaveAttribute('href', 'https://eproc.example.gov.in')
    expect(link).toHaveAttribute('target', '_blank')
    const saved = JSON.stringify((await repository.getBidSynopsis(bid.id, 'general'))?.document)
    expect(saved).toContain('E-Proc (https://eproc.example.gov.in)')
    expect(saved).toContain(dept.name)
  })

  it('shows General dates on the RFP Timeline in order, with gaps', async () => {
    const bid = await makeBid()
    await repository.saveBidSynopsis({
      bidId: bid.id, section: 'general', expectedRevision: 0,
      document: generalToDocument({ publishingDate: '2099-01-01', bidDeadline: '2099-01-31T15:00', queriesDeadline: '2099-01-10T17:00' }),
    })
    renderAt(`/bid-tracker/bid/${bid.id}?tab=rfpTimeline`)
    const list = await screen.findByRole('list', { name: 'RFP dates in order' })
    const text = list.textContent ?? ''
    expect(text.indexOf('Tender Publishing Date')).toBeLessThan(text.indexOf('Last Date & Time of Submission of Queries'))
    expect(text.indexOf('Last Date & Time of Submission of Queries')).toBeLessThan(text.indexOf('Last Date & Time of Submission of Bid'))
    expect(text).toContain('+9 days')
    expect(text).toContain('+21 days')
  })

  it('RFP Timeline empty state sends the user to General', async () => {
    const bid = await makeBid()
    renderAt(`/bid-tracker/bid/${bid.id}?tab=rfpTimeline`)
    await userEvent.click(await screen.findByRole('button', { name: 'Fill in General' }))
    expect(await screen.findByLabelText('Tender ID')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the department logo above the opportunity name', async () => {
    const [dept] = await repository.listDepartments()
    await repository.updateNode(dept.id, { metadata: { ...dept.metadata, logoUrl: 'data:image/png;base64,AAAA' } })
    const opp = await repository.createOpportunity({ departmentId: dept.id, opportunityName: 'Smart Bus', city: 'Pune', submissionDate: '2099-01-15' })
    const bid = await repository.createBid(opp.id)
    const { container } = renderAt(`/bid-tracker/bid/${bid.id}`)
    await screen.findByRole('heading', { name: 'Smart Bus' })
    await waitFor(() => expect(container.querySelector('img[src="data:image/png;base64,AAAA"]')).not.toBeNull())
  })

  it('edits a table section as a grid and saves it', async () => {
    const bid = await makeBid()
    renderAt(`/bid-tracker/bid/${bid.id}?tab=pq`)
    const grid = await screen.findByRole('grid', { name: 'PQ grid' })
    expect(grid).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Column 1 column menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move column right' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    const saved = await repository.getBidSynopsis(bid.id, 'pq')
    const node = saved!.document.content![0]
    expect(node.type).toBe('grid')
    expect((node.attrs!.grid as { columns: { name: string }[] }).columns.map(c => c.name).slice(0, 2)).toEqual(['Column 2', 'Column 1'])
  })
})

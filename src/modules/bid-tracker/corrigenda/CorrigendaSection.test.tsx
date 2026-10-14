import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { CorrigendaSection } from './CorrigendaSection'
import { loadSampleCorrigenda } from './sampleCorrigenda'

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Parking' })
  return repository.createBid(opp.id)
}
async function bidWithSample() {
  const bid = await makeBid()
  await loadSampleCorrigenda(bid.id, [], (i) => repository.createBidCorrigendum(i))
  return bid
}
function renderSection(bidId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><CorrigendaSection bidId={bidId} /></QueryClientProvider>)
}
const cardTitled = async (title: string) => (await screen.findByRole('heading', { name: title })).closest('article') as HTMLElement

describe('CorrigendaSection', () => {
  beforeEach(() => resetLocalData())

  it('6 · shows the corrigendum number as the main heading with the published/changes/impact line', async () => {
    const bid = await bidWithSample()
    renderSection(bid.id)
    const heading = await screen.findByRole('heading', { level: 3, name: 'CORRIGENDUM 02' })
    expect(heading).toHaveAttribute('data-testid', 'corrigendum-heading')
    expect(screen.getByTestId('corrigendum-subheading')).toHaveTextContent('Published: 14 Oct 2026|3 Changes|High Impact')
    // Each clause change is a card under that heading, not a row in a grid.
    expect(screen.getAllByTestId('change-card')).toHaveLength(3)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('7 · keeps the original and modified clause visually distinct', async () => {
    const bid = await bidWithSample()
    renderSection(bid.id)
    const card = await cardTitled('BoQ Item 3.4 — CCTV Cameras')
    const original = within(card).getByTestId('original-clause')
    const modified = within(card).getByTestId('modified-clause')
    expect(original).toHaveAccessibleName('Original clause')
    expect(modified).toHaveAccessibleName('Modified clause')
    expect(original.className).toContain('neu-inset')
    expect(modified.className).toContain('border-blue')
    expect(original.className).not.toEqual(modified.className)
  })

  it('8 · highlights exactly the changed text (deleted in original, added in modified)', async () => {
    const bid = await bidWithSample()
    renderSection(bid.id)
    const card = await cardTitled('Bid Submission End Date')
    const removed = [...within(card).getByTestId('original-clause').querySelectorAll('[data-diff="removed"]')].map((n) => n.textContent)
    const added = [...within(card).getByTestId('modified-clause').querySelectorAll('[data-diff="added"]')].map((n) => n.textContent)
    expect(removed).toEqual(['30 Oct'])
    expect(added).toEqual(['14 Nov'])
    expect(within(card).getByTestId('original-clause').querySelectorAll('[data-diff="added"]')).toHaveLength(0)
    expect(within(card).getAllByTestId('what-changed').map((n) => n.textContent)).toEqual(['30 Oct 2026→changed to14 Nov 2026'])

    const boq = await cardTitled('BoQ Item 3.4 — CCTV Cameras')
    expect([...boq.querySelectorAll('[data-diff]')].map((n) => `${n.getAttribute('data-diff')}:${n.textContent}`)).toEqual(['removed:500', 'added:750'])
    expect(within(boq).getByTestId('classification')).toHaveTextContent('BoQ | BoQ Item 3.4 — CCTV Cameras | Quantity Changed')
  })

  it('Current View shows the latest value with its source, and clicking the source opens that comparison', async () => {
    const bid = await bidWithSample()
    renderSection(bid.id)
    await screen.findByRole('heading', { name: 'CORRIGENDUM 02' })
    await userEvent.click(screen.getByRole('tab', { name: 'Current View' }))
    const rows = await screen.findAllByTestId('position-row')
    expect(rows).toHaveLength(5)
    const date = rows.find((r) => r.textContent?.includes('Bid Submission End Date'))!
    expect(within(date).getByTestId('position-value')).toHaveTextContent('14 Nov 2026')
    expect(within(date).getByRole('button')).toHaveTextContent('Updated through C2')

    const manpower = rows.find((r) => r.textContent?.includes('Key Personnel'))!
    await userEvent.click(within(manpower).getByRole('button', { name: /Updated through C1/ }))
    expect(await screen.findByRole('heading', { level: 3, name: 'CORRIGENDUM 01' })).toBeInTheDocument()
    const card = await cardTitled('Key Personnel — Project Manager')
    expect(card.className).toContain('ring-2')
  })

  it('History View shows Original Tender → C1 → C2 → Current Effective', async () => {
    const bid = await bidWithSample()
    renderSection(bid.id)
    await userEvent.click(await screen.findByRole('tab', { name: 'History View' }))
    const chain = screen.getByRole('list', { name: 'Version chain' })
    expect(within(chain).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Original Tender', 'C1', 'C2', 'Current Effective'])
    const date = screen.getByRole('region', { name: 'Bid Submission End Date history' })
    expect(within(date).getByTestId('history-original')).toHaveTextContent('15 Oct 2026')
    expect(within(date).getAllByRole('button', { name: /Open C\d comparison/ }).map((b) => b.textContent)).toEqual(['C1', 'C2'])
  })

  it('loads the sample from the empty state (dev, local mode) and lists C1 and C2 in the register', async () => {
    const bid = await makeBid()
    renderSection(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: /Load sample corrigenda/ }))
    await waitFor(() => expect(screen.getAllByTestId('register-entry')).toHaveLength(2))
    expect(screen.getAllByTestId('register-entry').map((e) => e.textContent?.slice(0, 2))).toEqual(['C1', 'C2'])
    expect(screen.queryByRole('button', { name: /Load sample corrigenda/ })).not.toBeInTheDocument()
  })

  it('accepting a change from its card lowers the open-action count', async () => {
    const bid = await bidWithSample()
    renderSection(bid.id)
    expect(await screen.findByText('3 open actions')).toBeInTheDocument()
    const card = await cardTitled('Payment Schedule — Go-Live')
    await userEvent.click(within(card).getByRole('button', { name: /Accept/ }))
    expect(await screen.findByText('2 open actions')).toBeInTheDocument()
  })
})

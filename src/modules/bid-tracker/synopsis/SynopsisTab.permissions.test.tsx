import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { PermissionsProvider } from '@/lib/permissions'
import { SynopsisTab } from './SynopsisTab'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const enforce = (role: 'bid' | 'sales' | 'presales' | 'legal') => ({ mode: 'enforce' as const, email: `${role}@amnex.com`, roles: [role], facts })
const off = { mode: 'off' as const, email: null, roles: [], facts: null }

async function renderTab(access: Parameters<typeof PermissionsProvider>[0]['access']) {
  const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus' })
  const bid = await repository.createBid(opportunity.id)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <PermissionsProvider access={access}>
        <SynopsisTab bidId={bid.id} section="pq" module="opp.bidTracker" />
      </PermissionsProvider>
    </QueryClientProvider>,
  )
  await screen.findByRole('textbox', { name: /document/i })
}

const editor = () => screen.getByRole('textbox', { name: /document/i })

describe('SynopsisTab edit controls follow the role (server rule for bidSynopsis.save: full write on the bid sheet)', () => {
  beforeEach(() => resetLocalData())

  it('shows every edit control, and an editable document, to the Bid role', async () => {
    await renderTab(enforce('bid'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Excel sheet' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument()
    expect(editor()).toHaveAttribute('contenteditable', 'true')
  })

  it.each(['sales', 'presales', 'legal'] as const)('gives %s a read-only document: no Save, Preview toggle, Import or toolbar', async (role) => {
    await renderTab(enforce(role))
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Preview|Edit)$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import Excel sheet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.getByText('View only')).toBeInTheDocument()
    expect(editor()).toHaveAttribute('contenteditable', 'false')
    // Reading stays available.
    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload saved section' })).toBeInTheDocument()
  })

  it('is unchanged when RBAC is off', async () => {
    await renderTab(off)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument()
    expect(editor()).toHaveAttribute('contenteditable', 'true')
  })
})

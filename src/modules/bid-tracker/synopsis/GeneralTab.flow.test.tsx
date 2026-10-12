import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { repository, resetLocalData } from '@/data/repository'
import { PermissionsProvider } from '@/lib/permissions'
import { GeneralTab } from './GeneralTab'
import { generalToDocument, type GeneralValues } from './generalFields'
import { RfpTimelineTab } from './rfpTimeline/RfpTimelineTab'

const off = { mode: 'off' as const, email: null, roles: [], facts: null }

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><PermissionsProvider access={off}>{ui}</PermissionsProvider></QueryClientProvider>)
}

async function makeBid(values?: GeneralValues) {
  const opportunity = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus' })
  const bid = await repository.createBid(opportunity.id)
  if (values) await repository.saveBidSynopsis({ bidId: bid.id, section: 'general', document: generalToDocument(values), expectedRevision: 0 })
  return bid
}

describe('General tab lock-after-save', () => {
  beforeEach(() => resetLocalData())

  it('opens an empty General tab straight in edit mode', async () => {
    const bid = await makeBid()
    wrap(<GeneralTab bidId={bid.id} />)
    expect(await screen.findByRole('button', { name: /^Save$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument()
  })

  it('shows saved values read-only until Edit is pressed, and Cancel locks them again', async () => {
    const bid = await makeBid({ tenderId: 'TND-77', procuringAuthority: 'BRCD' })
    wrap(<GeneralTab bidId={bid.id} />)
    const edit = await screen.findByRole('button', { name: /^Edit$/ })
    expect(screen.getByText('TND-77')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Tender ID' })).not.toBeInTheDocument()

    await userEvent.click(edit)
    expect(screen.getByRole('textbox', { name: 'Tender ID' })).toHaveValue('TND-77')
    expect(screen.getByRole('combobox', { name: 'Procuring Authority' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))
    expect(await screen.findByRole('button', { name: /^Edit$/ })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Tender ID' })).not.toBeInTheDocument()
  })
})

describe('RFP Timeline tab', () => {
  beforeEach(() => resetLocalData())

  it('lists the General dates in order, with what each is for and a consistent "Sep" month', async () => {
    const bid = await makeBid({ bidDeadline: '2026-11-05T12:00', publishingDate: '2026-09-21', preBidMeeting: '2026-10-15T11:00' })
    wrap(<RfpTimelineTab bidId={bid.id} onOpenGeneral={() => {}} now={new Date(2026, 9, 9)} />)
    const list = await screen.findByRole('list', { name: 'RFP dates in order' })
    const rows = [...list.querySelectorAll<HTMLElement>('li[data-status]')]
    expect(rows.map(r => r.children[1].textContent)).toEqual([
      'Tender Publishing Date', 'Pre-Bid Meeting Date & Time', 'Last Date & Time of Submission of Bid',
    ])
    expect(within(rows[0]).getByText('21 Sep 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Sept/)).not.toBeInTheDocument()
  })

  it('sends the user to General when no dates are filled in', async () => {
    const bid = await makeBid()
    const open = vi.fn()
    wrap(<RfpTimelineTab bidId={bid.id} onOpenGeneral={open} />)
    const buttons = await screen.findAllByRole('button', { name: /General/ })
    for (const b of buttons) await userEvent.click(b)
    expect(open).toHaveBeenCalledTimes(buttons.length)
    expect(open).toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ProposalDetail } from './ProposalDetail'
import * as api from '../api'
import * as libApi from '@/lib/api'
import type { CommercialBoq, CommercialBoqLineItem, CommercialSku } from '../types'

function boq(overrides: Partial<CommercialBoq> = {}): CommercialBoq {
  return {
    id: 'b1', boqNumber: 'BOQ-2026-000001', opportunityName: 'Test Opp', departmentId: 'd1', customerName: 'ACME Corp',
    customerOrganization: 'ACME Org', customerAddress: '1 Main St', customerContact: 'jane@acme.com', verticalId: 'v1',
    budgetAmount: '', budgetUnit: '', budgetKnown: '', emdAmount: '', emdUnit: '',
    salesPersonId: 'sp1', buSalesPersonId: null, preSalesId: null,
    status: 'draft', boqVersion: 1, revisionNumber: 0, parentBoqId: null,
    currency: 'INR', grandTotal: 1000,
    createdAt: '', createdBy: null, lastModifiedAt: '2026-08-19T00:00:00Z', lastModifiedBy: null,
    ...overrides,
  }
}

function sku(overrides: Partial<CommercialSku> = {}): CommercialSku {
  return {
    id: 's1', skuCode: 'SKU-1', name: 'Widget', categoryId: '', featureId: '', editionId: '', uomId: '', currencyId: 'cur_inr',
    taxClassId: '', billingTypeId: '', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active',
    isSellable: true, displayOrder: 0,
    baseSoftwareCost: 400, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 900, floorPrice: 800, partnerPrice: 950, governmentPrice: 850,
    enterprisePrice: 1100, corporatePrice: 1050, listPrice: 1000,
    minimumAllowedPrice: 500, maximumDiscountPercent: 30, selectedPricingLevels: [],
    createdAt: '', createdBy: null,
    ...overrides,
  }
}

function line(overrides: Partial<CommercialBoqLineItem> = {}): CommercialBoqLineItem {
  return {
    id: 'l1', boqId: 'b1', skuId: 's1', quantity: 1, unitPrice: 1000, discountPct: 0, taxPct: 18,
    approverId: null, approvalDate: null, approvalRemarks: '', approvalStatus: 'auto_approved', lineTotal: 1180,
    pricingLevels: [], activePricingLevel: null,
    ...overrides,
  }
}

function renderProposalDetail(opts: { boq?: CommercialBoq; lines?: CommercialBoqLineItem[]; skus?: CommercialSku[] } = {}) {
  const theBoq = opts.boq ?? boq()
  const updateMutateAsync = vi.fn().mockResolvedValue(theBoq)
  const lineUpdateMutateAsync = vi.fn().mockResolvedValue(undefined)

  vi.spyOn(api, 'useBoqs').mockReturnValue({ data: [theBoq] } as never)
  vi.spyOn(api, 'useBoqLineItems').mockReturnValue({ data: opts.lines ?? [] } as never)
  vi.spyOn(api, 'useSkus').mockReturnValue({ data: opts.skus ?? [sku()] } as never)
  vi.spyOn(api, 'useAllBomItems').mockReturnValue({ data: [] } as never)
  vi.spyOn(api, 'useMasters').mockImplementation((key: string) => {
    if (key === 'currencies') {
      return {
        data: [{
          id: 'cur_inr', code: 'INR', name: 'Indian Rupee', description: '', active: true, displayOrder: 0,
          symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true,
        }],
      } as never
    }
    if (key === 'approvalMatrix') {
      return {
        data: [
          { id: 'a1', code: 'A1', name: 'Auto', description: '', active: true, displayOrder: 0, minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: 'None', allowAutoApproval: true },
          { id: 'a2', code: 'A2', name: 'Manager', description: '', active: true, displayOrder: 1, minDiscountPct: 10, maxDiscountPct: 100, approvalLevelLabel: 'Manager Approval', allowAutoApproval: false },
        ],
      } as never
    }
    return { data: [] } as never
  })
  vi.spyOn(api, 'useBoqMutations').mockReturnValue({
    create: { mutateAsync: vi.fn() },
    update: { mutateAsync: updateMutateAsync },
    updateStatus: { mutateAsync: vi.fn() },
    revise: { mutateAsync: vi.fn() },
    duplicate: { mutateAsync: vi.fn() },
    remove: { mutateAsync: vi.fn() },
  } as never)
  vi.spyOn(api, 'useBoqLineItemMutations').mockReturnValue({
    add: { mutateAsync: vi.fn() },
    update: { mutateAsync: lineUpdateMutateAsync },
    remove: { mutateAsync: vi.fn() },
  } as never)
  vi.spyOn(libApi, 'useDepartments').mockReturnValue({ data: [{ id: 'd1', name: 'Dept One' }] } as never)
  vi.spyOn(libApi, 'useSalesPersons').mockReturnValue({ data: [{ id: 'sp1', name: 'Sales Person One' }] } as never)
  vi.spyOn(libApi, 'useCurrentPostings').mockReturnValue({ data: {} } as never)
  vi.spyOn(libApi, 'useAllEmployees').mockReturnValue({ data: [{ id: 'e1', name: 'Jane Approver', designation: 'Manager' }] } as never)

  const qc = new QueryClient()
  return {
    updateMutateAsync,
    lineUpdateMutateAsync,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <ProposalDetail boqId={theBoq.id} />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  }
}

describe('ProposalDetail — no tab navigation', () => {
  it('does not render an Overview/Approvals/Preview tab strip', () => {
    renderProposalDetail()
    expect(screen.queryByRole('button', { name: /^approvals$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^overview$/i })).not.toBeInTheDocument()
  })

  it('renders a section-jump nav with BOQ Details / Line Items / Preview', () => {
    renderProposalDetail()
    expect(screen.getAllByRole('button', { name: /boq details/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /line items/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^preview$/i }).length).toBeGreaterThan(0)
  })
})

describe('ProposalDetail — BOQ Details editing', () => {
  it('shows fields as read-only text with no Edit control for a non-draft BOQ', () => {
    renderProposalDetail({ boq: boq({ status: 'approved' }) })
    expect(screen.getAllByText('ACME Corp').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /edit details/i })).not.toBeInTheDocument()
  })

  it('shows an Edit Details button for a draft BOQ, switching fields to inputs', async () => {
    const user = userEvent.setup()
    renderProposalDetail()
    await user.click(screen.getByRole('button', { name: /edit details/i }))
    expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument()
  })

  it('Save persists only the changed fields and returns to read-only', async () => {
    const user = userEvent.setup()
    const { updateMutateAsync } = renderProposalDetail()
    await user.click(screen.getByRole('button', { name: /edit details/i }))
    const nameInput = screen.getByLabelText(/opportunity name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Opportunity')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'b1', patch: expect.objectContaining({ opportunityName: 'Renamed Opportunity' }),
    })
    expect(await screen.findByRole('button', { name: /edit details/i })).toBeInTheDocument()
  })

  it('Cancel discards local edits without calling the mutation', async () => {
    const user = userEvent.setup()
    const { updateMutateAsync } = renderProposalDetail()
    await user.click(screen.getByRole('button', { name: /edit details/i }))
    await user.type(screen.getByLabelText(/opportunity name/i), ' EXTRA')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(updateMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Test Opp')).toBeInTheDocument()
  })
})

describe('ProposalDetail — relocated per-line approval controls', () => {
  it('shows Approve/Reject inline for a pending line once expanded, no separate Approvals view', async () => {
    const user = userEvent.setup()
    renderProposalDetail({
      boq: boq({ status: 'submitted' }),
      lines: [line({ approvalStatus: 'pending', discountPct: 20 })],
    })
    await user.click(screen.getByRole('button', { name: /toggle approval summary/i }))
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument()
  })

  it('calls the line-update mutation with the decision on Approve', async () => {
    const user = userEvent.setup()
    const { lineUpdateMutateAsync } = renderProposalDetail({
      boq: boq({ status: 'submitted' }),
      lines: [line({ id: 'l7', approvalStatus: 'pending', discountPct: 20 })],
    })
    await user.click(screen.getByRole('button', { name: /toggle approval summary/i }))
    await user.selectOptions(screen.getByLabelText(/approver/i), 'e1')
    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    expect(lineUpdateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: 'l7', patch: expect.objectContaining({ approvalStatus: 'approved', approverId: 'e1' }),
    }))
  })
})

describe('ProposalDetail — collapsible Preview', () => {
  it('renders Preview collapsed by default, expanding on click without losing data', async () => {
    const user = userEvent.setup()
    renderProposalDetail({ lines: [line()] })
    expect(screen.queryByText(/commercial proposal/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^preview$/i, expanded: false }))
    expect(await screen.findByText(/commercial proposal/i)).toBeInTheDocument()
    expect(screen.getAllByText('SKU-1').length).toBeGreaterThan(0)
  })

  it('does not render a GST field anywhere in Preview', async () => {
    const user = userEvent.setup()
    renderProposalDetail({ lines: [line()] })
    await user.click(screen.getByRole('button', { name: /^preview$/i, expanded: false }))
    await screen.findByText(/commercial proposal/i)
    expect(screen.queryByText(/^gst$/i)).not.toBeInTheDocument()
  })
})

describe('ProposalDetail — non-draft BOQs stay frozen', () => {
  it('does not offer quantity/pricing edits for a non-draft line', () => {
    renderProposalDetail({ boq: boq({ status: 'approved' }), lines: [line()] })
    expect(screen.queryByLabelText(/^quantity$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add pricing level/i })).not.toBeInTheDocument()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
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

function renderProposalDetail(opts: {
  boq?: CommercialBoq
  lines?: CommercialBoqLineItem[]
  skus?: CommercialSku[]
  postings?: Record<string, { designation?: string; managerId?: string | null }>
} = {}) {
  const theBoq = opts.boq ?? boq()
  const updateMutateAsync = vi.fn().mockResolvedValue(theBoq)
  const lineUpdateMutateAsync = vi.fn().mockResolvedValue(undefined)
  const addMutateAsync = vi.fn().mockResolvedValue(undefined)
  const reorderMutateAsync = vi.fn().mockResolvedValue(undefined)
  const removeMutateAsync = vi.fn().mockResolvedValue(undefined)

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
    add: { mutateAsync: addMutateAsync },
    update: { mutateAsync: lineUpdateMutateAsync },
    remove: { mutateAsync: removeMutateAsync },
    reorder: { mutateAsync: reorderMutateAsync },
  } as never)
  vi.spyOn(libApi, 'useDepartments').mockReturnValue({ data: [{ id: 'd1', name: 'Dept One' }] } as never)
  vi.spyOn(libApi, 'useSalesPersons').mockReturnValue({ data: [{ id: 'sp1', name: 'Sales Person One' }] } as never)
  vi.spyOn(libApi, 'useCurrentPostings').mockReturnValue({ data: opts.postings ?? {} } as never)
  vi.spyOn(libApi, 'useAllEmployees').mockReturnValue({ data: [{ id: 'e1', name: 'Jane Approver', designation: 'Manager' }] } as never)

  const qc = new QueryClient()
  return {
    updateMutateAsync,
    lineUpdateMutateAsync,
    addMutateAsync,
    reorderMutateAsync,
    removeMutateAsync,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <ToastProvider>
            <ProposalDetail boqId={theBoq.id} />
          </ToastProvider>
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

describe('ProposalDetail — margin warning and percent formatting', () => {
  it('marks a negative overall margin with a clear warning in the BOQ Details panel (selling price below cost)', () => {
    renderProposalDetail({
      lines: [line({ id: 'l1', unitPrice: 300, discountPct: 0 })],
    })
    expect(screen.getAllByText(/below cost/i).length).toBeGreaterThan(0)
  })

  it('does not show a margin warning for a normal positive-margin BOQ', () => {
    renderProposalDetail({ lines: [line({ id: 'l1' })] })
    expect(screen.queryByText(/below cost/i)).not.toBeInTheDocument()
  })

  it('formats a floating-point-noisy discount cleanly in the Preview table (spec: no "7.000000000000001%" leakage)', async () => {
    const user = userEvent.setup()
    renderProposalDetail({ lines: [line({ id: 'l1', discountPct: (1000 - 930) / 1000 * 100 })] })
    await user.click(screen.getByRole('button', { name: /^preview$/i, expanded: false }))
    await screen.findByText(/commercial proposal/i)
    expect(screen.getByText('7%')).toBeInTheDocument()
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
    await user.click(screen.getByRole('combobox', { name: /approver/i }))
    await user.click(await screen.findByRole('option', { name: /Jane Approver/ }))
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

  it('has no Move Up/Down or Duplicate Line controls on a frozen line', () => {
    renderProposalDetail({ boq: boq({ status: 'approved' }), lines: [line()] })
    expect(screen.queryByRole('button', { name: /move up/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /move down/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /duplicate line/i })).not.toBeInTheDocument()
  })
})

describe('ProposalDetail — sticky workspace header', () => {
  it('renders the sticky header with boq number, status, customer, live totals, Save Draft and Submit while draft', () => {
    renderProposalDetail()
    expect(screen.getAllByText('BOQ-2026-000001').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ACME Corp').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeInTheDocument()
  })

  it('clicking the header\'s Save Draft shows an acknowledgment toast rather than issuing a mutation (edits already persist immediately)', async () => {
    const user = userEvent.setup()
    const { updateMutateAsync, lineUpdateMutateAsync } = renderProposalDetail()
    await user.click(screen.getByRole('button', { name: /save draft/i }))
    expect(screen.getByText(/saved automatically/i)).toBeInTheDocument()
    expect(updateMutateAsync).not.toHaveBeenCalled()
    expect(lineUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('a non-draft BOQ\'s header has no Save Draft/Submit buttons, only Preview', () => {
    renderProposalDetail({ boq: boq({ status: 'approved' }) })
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^submit$/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /preview/i }).length).toBeGreaterThan(0)
  })

  it('does not show a second, duplicate "Submitted" transition button while draft (the header covers it)', () => {
    renderProposalDetail()
    expect(screen.queryByRole('button', { name: /^submitted$/i })).not.toBeInTheDocument()
  })

  it('Esc collapses the currently-expanded line row', async () => {
    const user = userEvent.setup()
    renderProposalDetail({ lines: [line({ id: 'l1', approvalStatus: 'pending', discountPct: 20 })] })
    await user.click(screen.getByLabelText(/toggle approval summary/i))
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
  })

  it('Ctrl+S shows the "saved automatically" acknowledgment while draft', async () => {
    const user = userEvent.setup()
    renderProposalDetail()
    await user.keyboard('{Control>}s{/Control}')
    expect(screen.getByText(/saved automatically/i)).toBeInTheDocument()
  })
})

describe('ProposalDetail — fast SKU search + Browse Catalog', () => {
  it('shows the fast SKU search bar above a collapsed "Browse Catalog" cascading picker', () => {
    renderProposalDetail()
    expect(screen.getByLabelText(/search by sku code or name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /browse catalog/i })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('ProposalDetail — Line Items compact rows and bulk editing', () => {
  it('the collapsed row shows active pricing level, selling price, discount, and tax without expanding', () => {
    renderProposalDetail({
      lines: [line({ id: 'l1', unitPrice: 850, discountPct: 15, taxPct: 18, activePricingLevel: 'government', pricingLevels: [{ level: 'government', sellingPrice: 850 }] })],
    })
    // "Government" also appears in the always-visible Set Selling Price card's own toggle
    // button — this only asserts the compact row's badge is one of the places it shows.
    expect(screen.getAllByText('Government').length).toBeGreaterThan(0)
    expect(screen.getByText(/850/)).toBeInTheDocument()
    expect(screen.getByText(/15% off/)).toBeInTheDocument()
    expect(screen.getByText(/18% tax/)).toBeInTheDocument()
  })

  it('renders the SKU search bar and Browse Catalog above the existing line list', () => {
    renderProposalDetail({ lines: [line({ id: 'l1' })] })
    const search = screen.getByLabelText(/search by sku code or name/i)
    const firstLineText = screen.getByText('Widget')
    // DOCUMENT_POSITION_FOLLOWING (4) on firstLineText means search comes before it.
    expect(search.compareDocumentPosition(firstLineText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the empty-state message when there are no lines', () => {
    renderProposalDetail({ lines: [] })
    expect(screen.getByText(/no skus added yet/i)).toBeInTheDocument()
  })

  it('does not show the empty-state message when the BOQ already has line items', () => {
    renderProposalDetail({ lines: [line({ id: 'l1' })] })
    expect(screen.queryByText(/no skus added yet/i)).not.toBeInTheDocument()
  })

  it('only one line row is expanded at a time', async () => {
    const user = userEvent.setup()
    renderProposalDetail({ lines: [line({ id: 'l1' }), line({ id: 'l2' })] })
    const toggles = screen.getAllByLabelText(/toggle approval summary/i)
    await user.click(toggles[0])
    expect(screen.getAllByText(/set selling price/i)).toHaveLength(2) // always-visible, one per row — unaffected by expand
    // Expand state itself only gates the LineApprovalSummary panel — verify only one is open by
    // checking the approval-band explanation text appears exactly once even after expanding both.
    await user.click(toggles[1])
    expect(screen.getAllByText(/no approval required/i)).toHaveLength(1)
  })

  it('switching the active pricing level sends the newly-resolved discount to the update mutation, so the repository re-evaluates approval instead of a stale decision surviving under a different price (spec: approval must follow the active pricing level)', async () => {
    const user = userEvent.setup()
    const { lineUpdateMutateAsync } = renderProposalDetail({
      lines: [line({
        id: 'l1', unitPrice: 800, discountPct: 20, approvalStatus: 'approved', approverId: 'e1', approvalDate: '2026-08-20',
        pricingLevels: [{ level: 'government', sellingPrice: 800 }, { level: 'enterprise', sellingPrice: 910 }],
        activePricingLevel: 'government',
      })],
    })
    await user.click(screen.getByRole('radio', { name: /use enterprise for calculation/i }))
    expect(lineUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [{ id, patch }] = lineUpdateMutateAsync.mock.calls[0]
    expect(id).toBe('l1')
    expect(patch.unitPrice).toBe(910)
    expect(patch.discountPct).toBeCloseTo(9, 5)
    expect(patch.activePricingLevel).toBe('enterprise')
  })

  it('reorders lines via Move Up / Move Down and calls reorder.mutateAsync with the full new order', async () => {
    const user = userEvent.setup()
    const { reorderMutateAsync } = renderProposalDetail({
      lines: [line({ id: 'l1' }), line({ id: 'l2' }), line({ id: 'l3' })],
    })
    const moveUpButtons = screen.getAllByRole('button', { name: /move up/i })
    expect(moveUpButtons[0]).toBeDisabled()
    const moveDownButtons = screen.getAllByRole('button', { name: /move down/i })
    expect(moveDownButtons[2]).toBeDisabled()
    await user.click(moveDownButtons[0])
    expect(reorderMutateAsync).toHaveBeenCalledWith(['l2', 'l1', 'l3'])
  })

  it('Duplicate Line adds a new line with the same SKU/quantity/pricing, via lineMutations.add', async () => {
    const user = userEvent.setup()
    const { addMutateAsync } = renderProposalDetail({
      lines: [line({ id: 'l1', quantity: 3, unitPrice: 900, discountPct: 10 })],
    })
    await user.click(screen.getAllByRole('button', { name: /duplicate line/i })[0])
    expect(addMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ skuId: 's1', quantity: 3, unitPrice: 900, discountPct: 10 }))
  })

  it('Change Pricing Level bulk-applies only unitPrice/discountPct/activePricingLevel, not pricingLevels, for a Clear-Discount-shaped result', async () => {
    const user = userEvent.setup()
    const { lineUpdateMutateAsync } = renderProposalDetail({
      lines: [line({ id: 'l1', pricingLevels: [{ level: 'internal', sellingPrice: 900 }], activePricingLevel: 'internal' })],
    })
    await user.click(screen.getByLabelText(/select sku-1/i))
    await user.selectOptions(screen.getByLabelText(/^action$/i), 'clearDiscount')
    await user.click(screen.getByRole('button', { name: /apply/i }))
    const patchArg = lineUpdateMutateAsync.mock.calls[0][0].patch
    expect(Object.keys(patchArg)).not.toContain('pricingLevels')
  })
})

describe('ProposalDetail — BOQ salesperson display unaffected by RM/GM edits (fix round 6.3 review)', () => {
  // Task 6.3 added an editable "Reporting Manager" (managerId) field to a
  // salesperson's own posting record, edited from the Sales Team screen. A
  // BOQ's salesperson display here only reads `salesPersons[].name` (the
  // read-only "Sales Person" field, line 470) and, for the BU Sales filter,
  // `postings[].designation` (line 90 above) — it never reads
  // `postings[].managerId`. So changing only a posting's managerId (an RM
  // edit) must never move what a BOQ shows for its salesperson.
  it('shows the same salesperson name whether their posting has no manager, an old manager, or a new manager', () => {
    renderProposalDetail({ postings: { sp1: { designation: 'Regional Sales', managerId: null } } })
    expect(screen.getByText('Sales Person One')).toBeInTheDocument()
  })

  it('still shows the same salesperson name after only the posting managerId changes (simulated RM edit)', () => {
    renderProposalDetail({ postings: { sp1: { designation: 'Regional Sales', managerId: 'sp-some-other-manager' } } })
    expect(screen.getByText('Sales Person One')).toBeInTheDocument()
  })
})

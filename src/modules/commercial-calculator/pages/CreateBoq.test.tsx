import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateBoq } from './CreateBoq'
import * as api from '../api'
import * as libApi from '@/lib/api'
import type { CommercialSku } from '../types'

function sku(overrides: Partial<CommercialSku> = {}): CommercialSku {
  return {
    id: 's1', skuCode: 'GOV-GOMS-AM-HIER-NEW', name: 'Hierarchy Tree Feature', categoryId: '', featureId: 'f1', editionId: '',
    uomId: '', currencyId: 'cur_inr', taxClassId: 't1', billingTypeId: '', activeFrom: '2026-01-01', activeTill: null,
    lifecycleStatus: 'active', isSellable: true, displayOrder: 0,
    baseSoftwareCost: 400, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 900, floorPrice: 800, partnerPrice: 950, governmentPrice: 850,
    enterprisePrice: 1100, corporatePrice: 1050, listPrice: 1000,
    minimumAllowedPrice: 500, maximumDiscountPercent: 30, selectedPricingLevels: [],
    createdAt: '', createdBy: null,
    ...overrides,
  }
}

function renderCreateBoq(skuOverrides: Partial<CommercialSku> = {}) {
  const create = { mutateAsync: vi.fn().mockResolvedValue({ boq: { id: 'b1', boqNumber: 'BOQ-2026-000001' } }) }
  vi.spyOn(api, 'useMasters').mockImplementation((key: string) => {
    if (key === 'verticals') return { data: [{ id: 'v1', code: 'GOV', name: 'Government', description: '', active: true, displayOrder: 0 }] } as never
    if (key === 'products') return { data: [{ id: 'p1', code: 'GOMS', name: 'GOMS', description: '', active: true, displayOrder: 0, verticalId: 'v1' }] } as never
    if (key === 'modules') return { data: [{ id: 'm1', code: 'AM', name: 'Account Mapping', description: '', active: true, displayOrder: 0, productId: 'p1' }] } as never
    if (key === 'features') return { data: [{ id: 'f1', code: 'HIER', name: 'Hierarchy Tree', description: '', active: true, displayOrder: 0, moduleId: 'm1', status: 'new' }] } as never
    if (key === 'taxClasses') return { data: [{ id: 't1', code: 'T1', name: '18%', description: '', active: true, displayOrder: 0, ratePct: 18 }] } as never
    if (key === 'currencies') return { data: [{ id: 'cur_inr', code: 'INR', name: 'Rupee', description: '', active: true, displayOrder: 0, symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true }] } as never
    if (key === 'approvalMatrix') {
      return { data: [{ id: 'a1', code: 'A1', name: 'Auto', description: '', active: true, displayOrder: 0, minDiscountPct: 0, maxDiscountPct: 100, approvalLevelLabel: 'None', allowAutoApproval: true }] } as never
    }
    return { data: [] } as never
  })
  vi.spyOn(api, 'useSkus').mockReturnValue({ data: [sku(skuOverrides)] } as never)
  vi.spyOn(api, 'useAllBomItems').mockReturnValue({ data: [] } as never)
  vi.spyOn(api, 'useBoqs').mockReturnValue({ data: [] } as never)
  vi.spyOn(api, 'useBoqMutations').mockReturnValue({
    create,
    updateStatus: { mutateAsync: vi.fn() },
  } as never)
  vi.spyOn(libApi, 'useDepartments').mockReturnValue({ data: [{ id: 'd1', name: 'Dept One' }] } as never)
  vi.spyOn(libApi, 'useSalesPersons').mockReturnValue({ data: [{ id: 'sp1', name: 'Sales Person One' }] } as never)
  vi.spyOn(libApi, 'useCurrentPostings').mockReturnValue({ data: {} } as never)
  vi.spyOn(libApi, 'useEmployeesUnder').mockReturnValue({ data: [] } as never)
  vi.spyOn(libApi, 'useEmployeeMutations').mockReturnValue({ create: { mutateAsync: vi.fn() } } as never)
  const qc = new QueryClient()
  return {
    create,
    ...render(
      <QueryClientProvider client={qc}>
        <CreateBoq onCancel={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    ),
  }
}

async function pickCombobox(user: ReturnType<typeof userEvent.setup>, label: string, optionName: string) {
  await user.click(screen.getByRole('combobox', { name: new RegExp(label, 'i') }))
  await user.click(await screen.findByRole('option', { name: new RegExp(optionName, 'i') }))
}

async function addOneLine(user: ReturnType<typeof userEvent.setup>) {
  await pickCombobox(user, 'Vertical', 'Government')
  await user.click(screen.getByRole('button', { name: /browse catalog/i }))
  await pickCombobox(user, 'Product', 'GOMS')
  await pickCombobox(user, 'Module', 'Account Mapping')
  await pickCombobox(user, 'Feature', 'Hierarchy Tree')
  await user.click(screen.getByRole('button', { name: /add to proposal/i }))
}

describe('CreateBoq — sticky workspace header', () => {
  it('renders the sticky header showing New BOQ and Save Draft/Submit', () => {
    renderCreateBoq()
    expect(screen.getByText('New BOQ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeInTheDocument()
  })

  it('clicking the header\'s Preview button expands the Preview section', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    // The sticky section-jump nav also has a "Preview" pill with the same accessible name — the
    // header's own Preview action button is the first "Preview" in the DOM (rendered above the nav).
    await user.click(screen.getAllByRole('button', { name: /^preview$/i })[0])
    expect(screen.getByRole('button', { name: /^preview$/i, expanded: true })).toBeInTheDocument()
  })

  it('the bottom action row no longer has its own Save Draft/Submit buttons', () => {
    renderCreateBoq()
    expect(screen.getAllByRole('button', { name: /save draft/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^submit$/i })).toHaveLength(1)
  })

  it('Esc collapses the currently-expanded configured line row\'s approval summary', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByLabelText(/toggle approval summary/i))
    expect(screen.getByText(/no approval required/i)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/no approval required/i)).not.toBeInTheDocument()
  })

  it('Ctrl+S respects the same validation gate as the (disabled) Save Draft button — does not save while required fields are missing', async () => {
    const user = userEvent.setup()
    const { create } = renderCreateBoq()
    await user.keyboard('{Control>}s{/Control}')
    expect(create.mutateAsync).not.toHaveBeenCalled()
  })
})

describe('CreateBoq — no separate Pricing/Approval tabs', () => {
  it('renders a section-jump nav with BOQ Details / Line Items / Preview only', () => {
    renderCreateBoq()
    expect(screen.getAllByRole('button', { name: /boq details/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /line items/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^preview$/i }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^pricing$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approval$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^opportunity$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^customer$/i })).not.toBeInTheDocument()
  })

  it('combines Opportunity and Customer fields into a single BOQ Details section', () => {
    renderCreateBoq()
    expect(screen.getByRole('button', { name: /boq details/i, expanded: true })).toBeInTheDocument()
    expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument()
    expect(screen.getByText(/^stakeholder contact$/i)).toBeInTheDocument()
  })
})

describe('CreateBoq — fast SKU search + Browse Catalog', () => {
  it('shows the fast SKU search bar above a collapsed "Browse Catalog" cascading picker once a Vertical is picked', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await pickCombobox(user, 'Vertical', 'Government')
    expect(screen.getByLabelText(/search by sku code or name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /browse catalog/i })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('CreateBoq — line rows', () => {
  it('adding the same SKU twice via Duplicate Line produces a second, independently editable row', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /duplicate line/i }))
    const rows = screen.getAllByText(/hierarchy tree feature/i)
    expect(rows).toHaveLength(2)
  })

  it('Move Up is disabled on the first line', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /duplicate line/i }))
    const moveUpButtons = screen.getAllByRole('button', { name: /move up/i })
    expect(moveUpButtons[0]).toBeDisabled()
  })

  it('Move Down swaps two lines\' quantities in the underlying data', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /duplicate line/i }))
    const secondLineQty = screen.getAllByLabelText(/^quantity$/i)[1]
    await user.clear(secondLineQty)
    await user.type(secondLineQty, '9')
    await user.tab()
    const quantityInputsBefore = screen.getAllByLabelText(/^quantity$/i).map((el) => (el as HTMLInputElement).value)
    expect(quantityInputsBefore).toEqual(['1', '9'])
    await user.click(screen.getAllByRole('button', { name: /move down/i })[0])
    const quantityInputsAfter = screen.getAllByLabelText(/^quantity$/i).map((el) => (el as HTMLInputElement).value)
    expect(quantityInputsAfter).toEqual(['9', '1'])
  })

  it('only one configured line row has its approval summary expanded at a time', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /duplicate line/i }))
    const toggles = screen.getAllByLabelText(/toggle approval summary/i)
    await user.click(toggles[0])
    expect(screen.getAllByText(/no approval required/i)).toHaveLength(1)
    await user.click(toggles[1])
    expect(screen.getAllByText(/no approval required/i)).toHaveLength(1)
  })

  it('the Set Selling Price section is always visible, without needing to expand the row', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    expect(screen.getByText(/set selling price/i)).toBeInTheDocument()
  })

  it('the collapsed row shows tax without expanding', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    expect(screen.getByText(/18% tax/)).toBeInTheDocument()
  })

  it('shows the empty-state message before any line is added, and hides it once a line exists', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    expect(screen.getByText(/no skus added yet/i)).toBeInTheDocument()
    await addOneLine(user)
    expect(screen.queryByText(/no skus added yet/i)).not.toBeInTheDocument()
  })

  it('rejects a quantity of 0 with an inline message and preserves the previous valid quantity', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    const qtyInput = screen.getByLabelText(/^quantity$/i)
    await user.clear(qtyInput)
    await user.type(qtyInput, '0')
    await user.tab()
    expect(screen.getByText(/at least 1/i)).toBeInTheDocument()
    expect(qtyInput).toHaveValue(1)
  })

  it('rejects a negative quantity with an inline message', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    const qtyInput = screen.getByLabelText(/^quantity$/i)
    await user.clear(qtyInput)
    await user.type(qtyInput, '-5')
    await user.tab()
    expect(screen.getByText(/at least 1/i)).toBeInTheDocument()
    expect(qtyInput).toHaveValue(1)
  })

  it('formats a floating-point-noisy discount cleanly on the collapsed row and in the Preview table (spec: no "7.000000000000001%" leakage)', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    await user.click(await screen.findByRole('checkbox', { name: /^internal$/i }))
    await user.click(screen.getByRole('button', { name: /add selected/i }))
    const priceInput = screen.getByLabelText(/internal selling price/i)
    await user.type(priceInput, '930') // list price 1000 -> (1000-930)/1000*100 = 7.000000000000001
    await user.tab()
    expect(screen.getByText(/^7% off$/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /^preview$/i })[0])
    expect(await screen.findByText('7%')).toBeInTheDocument()
    expect(screen.queryByText(/7\.000000000000001/)).not.toBeInTheDocument()
  })

  it('marks a negative overall margin (selling price below cost) with a clear warning', async () => {
    const user = userEvent.setup()
    renderCreateBoq({ baseSoftwareCost: 1200 }) // cost 1200 > list price 1000, even at zero discount
    await addOneLine(user)
    expect(screen.getAllByText(/below cost/i).length).toBeGreaterThan(0)
  })

  it('does not show a margin warning for a normal positive-margin line', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    expect(screen.queryByText(/below cost/i)).not.toBeInTheDocument()
  })
})

describe('CreateBoq — bulk editing', () => {
  it('offers Select all and the shared BulkEditBar once lines exist, without a Delete action', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByLabelText(/select all lines/i))
    expect(screen.getByLabelText(/^action$/i)).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^delete$/i })).not.toBeInTheDocument()
  })

  it('bulk Change Quantity updates every selected line\'s quantity', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /duplicate line/i }))
    await user.click(screen.getByLabelText(/select all lines/i))
    await user.selectOptions(screen.getByLabelText(/^action$/i), 'setQuantity')
    // The BulkEditBar's own "Quantity" value field renders above the line rows'
    // per-line "Quantity" inputs, all sharing the same accessible name.
    await user.type(screen.getAllByLabelText(/^quantity$/i)[0], '7')
    await user.click(screen.getByRole('button', { name: /apply/i }))
    const quantityInputs = screen.getAllByLabelText(/^quantity$/i).map((el) => (el as HTMLInputElement).value)
    expect(quantityInputs).toEqual(['7', '7'])
  })
})

describe('CreateBoq — Stakeholder Contact address (item 4: inherits from Department, not the employee)', () => {
  it('fills Address from the selected Department, not the picked employee\'s own (possibly stale) address field', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    // Overridden after the initial render (matching the Opportunity Name
    // uniqueness test below) — a later re-render (triggered by the Department
    // pick itself) re-reads these updated mocks.
    vi.spyOn(libApi, 'useDepartments').mockReturnValue({
      data: [{ id: 'd1', name: 'Dept One', metadata: { officeAddress: '1 Department Road, Capital City' } }],
    } as never)
    vi.spyOn(libApi, 'useEmployeesUnder').mockReturnValue({
      data: [{ id: 'emp1', name: 'Stakeholder Person', designation: 'Director', phone: '', email: '', vacant: false, photoUrl: null, address: 'Stale Personal Address' }],
    } as never)

    await pickCombobox(user, 'Department', 'Dept One')
    await user.type(screen.getByPlaceholderText(/search a stakeholder/i), 'Stakeholder Person')
    await user.click(await screen.findByText('Stakeholder Person'))

    expect(screen.getByLabelText(/^address$/i)).toHaveValue('1 Department Road, Capital City')
  })
})

describe('CreateBoq — Opportunity Name uniqueness', () => {
  it('blocks Save and shows an inline message when the typed name is already used by another BOQ', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    // Set after the initial render (which itself mocks an empty BOQ list) — the
    // typing below triggers a re-render that re-reads this updated mock.
    vi.spyOn(api, 'useBoqs').mockReturnValue({
      data: [{ id: 'other', boqNumber: 'BOQ-2026-000001', opportunityName: 'Existing Opp' }],
    } as never)
    await user.type(screen.getByLabelText(/opportunity name/i), 'Existing Opp')
    // Both the inline field error and the "Missing:" checklist mention the
    // clashing BOQ number — assert on the inline field error specifically.
    const fieldError = await screen.findByText(/already used by boq-2026-000001\. choose a different name/i)
    expect(fieldError).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save draft/i })).toBeDisabled()
  })
})

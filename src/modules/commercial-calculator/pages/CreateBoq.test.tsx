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

  it('clicking the header\'s Preview button expands the BOQ Preview section', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    // The sticky section-jump nav also has a "Preview" pill with the same accessible name — the
    // header's own Preview action button is the first "Preview" in the DOM (rendered above the nav).
    await user.click(screen.getAllByRole('button', { name: /^preview$/i })[0])
    expect(screen.getByRole('button', { name: /boq preview/i })).toHaveAttribute('aria-expanded', 'true')
  })

  it('the bottom action row no longer has its own Save Draft/Submit buttons', () => {
    renderCreateBoq()
    expect(screen.getAllByRole('button', { name: /save draft/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^submit$/i })).toHaveLength(1)
  })

  it('Esc collapses the currently-expanded configured line row', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByLabelText(/toggle pricing details/i))
    expect(screen.getByText(/set selling price/i)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/set selling price/i)).not.toBeInTheDocument()
  })

  it('Ctrl+S respects the same validation gate as the (disabled) Save Draft button — does not save while required fields are missing', async () => {
    const user = userEvent.setup()
    const { create } = renderCreateBoq()
    await user.keyboard('{Control>}s{/Control}')
    expect(create.mutateAsync).not.toHaveBeenCalled()
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

  it('Move Up is disabled on the first line; Move Down swaps two lines\' displayed order', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /duplicate line/i }))
    const moveUpButtons = screen.getAllByRole('button', { name: /move up/i })
    expect(moveUpButtons[0]).toBeDisabled()
    // SkuAddPanel's own Quantity field only renders while a SKU is resolved, and picking a
    // Feature resets the picker's selection right after Add — so by now only the two line
    // rows' own Quantity inputs remain, in order.
    const secondLineQty = screen.getAllByLabelText(/^quantity$/i)[1]
    await user.clear(secondLineQty)
    await user.type(secondLineQty, '9')
    const quantityInputsBefore = screen.getAllByLabelText(/^quantity$/i).map((el) => (el as HTMLInputElement).value)
    await user.click(screen.getAllByRole('button', { name: /move down/i })[0])
    const quantityInputsAfter = screen.getAllByLabelText(/^quantity$/i).map((el) => (el as HTMLInputElement).value)
    expect(quantityInputsAfter).toEqual([quantityInputsBefore[1], quantityInputsBefore[0]])
  })

  it('only one configured line row is expanded at a time', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /duplicate line/i }))
    const toggles = screen.getAllByLabelText(/toggle pricing details/i)
    await user.click(toggles[0])
    expect(screen.getAllByText(/set selling price/i)).toHaveLength(1)
    await user.click(toggles[1])
    expect(screen.getAllByText(/set selling price/i)).toHaveLength(1)
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

  it('formats a floating-point-noisy discount cleanly on the collapsed row and in the Preview table (spec: no "7.000000000000001%" leakage)', async () => {
    const user = userEvent.setup()
    renderCreateBoq()
    await addOneLine(user)
    await user.click(screen.getByLabelText(/toggle pricing details/i))
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

  it('marks a negative overall margin (selling price below cost) with a clear warning in the Pricing Summary section', async () => {
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

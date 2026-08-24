import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SkuSearchBar } from './SkuSearchBar'
import * as api from '../api'
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

function renderSearchBar(onAdd = vi.fn(), existingSkuIds?: Set<string>) {
  vi.spyOn(api, 'useSkus').mockReturnValue({ data: [sku(), sku({ id: 's2', skuCode: 'OTHER-CODE', name: 'Unrelated', featureId: 'f2' })] } as never)
  vi.spyOn(api, 'useMasters').mockImplementation((key: string) => {
    if (key === 'products') return { data: [{ id: 'p1', code: 'GOMS', name: 'GOMS', description: '', active: true, displayOrder: 0, verticalId: 'v1' }] } as never
    if (key === 'modules') return { data: [{ id: 'm1', code: 'AM', name: 'Account Mapping', description: '', active: true, displayOrder: 0, productId: 'p1' }] } as never
    if (key === 'features') {
      return {
        data: [
          { id: 'f1', code: 'HIER', name: 'Hierarchy Tree', description: '', active: true, displayOrder: 0, moduleId: 'm1', status: 'new' },
          { id: 'f2', code: 'OTHER', name: 'Other Feature', description: '', active: true, displayOrder: 0, moduleId: 'm-other', status: 'new' },
        ],
      } as never
    }
    if (key === 'taxClasses') return { data: [{ id: 't1', code: 'T1', name: '18%', description: '', active: true, displayOrder: 0, ratePct: 18 }] } as never
    if (key === 'currencies') return { data: [{ id: 'cur_inr', code: 'INR', name: 'Rupee', description: '', active: true, displayOrder: 0, symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true }] } as never
    return { data: [] } as never
  })
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <SkuSearchBar verticalId="v1" currencyCode="INR" bomItems={[]} existingSkuIds={existingSkuIds} onAdd={onAdd} />
    </QueryClientProvider>,
  )
}

describe('SkuSearchBar', () => {
  it('finds a SKU by partial code and lets you select it to reveal the add panel', async () => {
    const user = userEvent.setup()
    renderSearchBar()
    await user.type(screen.getByLabelText(/search by sku code or name/i), 'HIER')
    await user.click(screen.getByText(/hierarchy tree feature/i))
    expect(screen.getByRole('button', { name: /add to proposal/i })).toBeInTheDocument()
  })

  it('finds a SKU by name', async () => {
    const user = userEvent.setup()
    renderSearchBar()
    await user.type(screen.getByLabelText(/search by sku code or name/i), 'hierarchy')
    expect(screen.getByText(/gov-goms-am-hier-new/i)).toBeInTheDocument()
  })

  it('excludes SKUs outside the given vertical', async () => {
    const user = userEvent.setup()
    renderSearchBar()
    await user.type(screen.getByLabelText(/search by sku code or name/i), 'OTHER-CODE')
    expect(screen.queryByText(/other-code/i)).not.toBeInTheDocument()
  })

  it('calls onAdd, via the shared SkuAddPanel, with the searched SKU\'s id', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    renderSearchBar(onAdd)
    await user.type(screen.getByLabelText(/search by sku code or name/i), 'HIER')
    await user.click(screen.getByText(/hierarchy tree feature/i))
    await user.click(screen.getByRole('button', { name: /add to proposal/i }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ skuId: 's1' }))
  })

  it('shows "no SKU matches your search" when the Vertical has SKUs but none match the typed text', async () => {
    const user = userEvent.setup()
    renderSearchBar()
    await user.type(screen.getByLabelText(/search by sku code or name/i), 'nonexistent-code')
    expect(screen.getByText(/no sku matches your search/i)).toBeInTheDocument()
    expect(screen.queryByText(/no skus are configured for this vertical/i)).not.toBeInTheDocument()
  })

  it('shows "no SKUs configured for this Vertical" — distinct from a no-match search — when the Vertical has none at all', () => {
    vi.spyOn(api, 'useSkus').mockReturnValue({ data: [] } as never)
    vi.spyOn(api, 'useMasters').mockImplementation(() => ({ data: [] }) as never)
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <SkuSearchBar verticalId="v1" currencyCode="INR" bomItems={[]} onAdd={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/no skus are configured for this vertical/i)).toBeInTheDocument()
    expect(screen.queryByText(/no sku matches your search/i)).not.toBeInTheDocument()
  })

  it('warns, without blocking, when the picked SKU is already on the BOQ', async () => {
    const user = userEvent.setup()
    renderSearchBar(vi.fn(), new Set(['s1']))
    await user.type(screen.getByLabelText(/search by sku code or name/i), 'HIER')
    await user.click(screen.getByText(/hierarchy tree feature/i))
    expect(screen.getByText(/already in the boq/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add to proposal/i })).not.toBeDisabled()
  })
})

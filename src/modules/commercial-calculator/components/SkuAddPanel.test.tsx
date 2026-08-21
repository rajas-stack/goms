import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SkuAddPanel } from './SkuAddPanel'
import * as api from '../api'
import type { CommercialBomItem, CommercialSku } from '../types'

function sku(overrides: Partial<CommercialSku> = {}): CommercialSku {
  return {
    id: 's1', skuCode: 'SKU-1', name: 'Widget', categoryId: '', featureId: '', editionId: '', uomId: '', currencyId: 'cur_inr',
    taxClassId: 't1', billingTypeId: '', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active',
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

function renderPanel(opts: { onAdd?: (line: unknown) => void } = {}) {
  vi.spyOn(api, 'useMasters').mockImplementation((key: string) => {
    if (key === 'taxClasses') return { data: [{ id: 't1', code: 'T1', name: '18%', description: '', active: true, displayOrder: 0, ratePct: 18 }] } as never
    if (key === 'currencies') {
      return { data: [{ id: 'cur_inr', code: 'INR', name: 'Rupee', description: '', active: true, displayOrder: 0, symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true }] } as never
    }
    return { data: [] } as never
  })
  const component = sku({ id: 's2', skuCode: 'SKU-2', baseSoftwareCost: 100 })
  const bomItems: CommercialBomItem[] = [{ id: 'bom1', parentSkuId: 's1', componentSkuId: 's2', mandatory: true, quantity: 1, notes: '' }]
  const skusById = new Map([['s1', sku()], ['s2', component]])
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <SkuAddPanel sku={sku()} skusById={skusById} currencyCode="INR" bomItems={bomItems} onAdd={opts.onAdd ?? vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('SkuAddPanel', () => {
  it('rolls a mandatory BOM component\'s cost into the Set Selling Price margin (needs the full skusById map, not just this one SKU)', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    await user.click(screen.getByLabelText('Internal'))
    await user.click(screen.getByRole('button', { name: /add selected/i }))
    // sellingPrice defaults to null until typed — type a price equal to listPrice (1000) so margin
    // is easy to hand-check: (1000 - totalCost) / 1000. totalCost must include the mandatory
    // component's own baseSoftwareCost (100) on top of the parent's own (400) = 500, not just 400.
    const priceInput = screen.getByLabelText(/internal selling price/i)
    await user.type(priceInput, '1000')
    priceInput.blur()
    const marginInput = await screen.findByLabelText(/internal margin/i)
    expect(marginInput).toHaveValue(50) // (1000 - 500) / 1000 * 100 = 50, not (1000-400)/1000*100=60
  })

  it('calls onAdd with the current quantity/pricing, then resets its own qty/pricing state', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    renderPanel({ onAdd })
    await user.clear(screen.getByLabelText(/quantity/i))
    await user.type(screen.getByLabelText(/quantity/i), '4')
    await user.click(screen.getByRole('button', { name: /add to proposal/i }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ skuId: 's1', quantity: 4, discountPct: 0, pricingLevels: [], activePricingLevel: null }))
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(1)
  })
})

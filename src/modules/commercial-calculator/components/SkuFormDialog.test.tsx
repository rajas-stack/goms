import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SkuFormDialog } from './SkuFormDialog'
import * as api from '../api'
import type { CommercialSku } from '../types'

// jsdom has no matchMedia implementation — Dialog's responsive List/Canvas
// hook (useMediaQuery) needs one to mount at all.
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

function sku(overrides: Partial<CommercialSku> = {}): CommercialSku {
  return {
    id: 's1', skuCode: 'X', name: 'Widget', categoryId: '', featureId: '', editionId: '', uomId: '', currencyId: '',
    taxClassId: '', billingTypeId: '', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active',
    isSellable: true, displayOrder: 0,
    baseSoftwareCost: 0, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 900, floorPrice: 800, partnerPrice: 950, governmentPrice: 850,
    enterprisePrice: 1100, corporatePrice: 1050, listPrice: 1000,
    minimumAllowedPrice: 500, maximumDiscountPercent: 30, selectedPricingLevels: [],
    createdAt: '', createdBy: null,
    ...overrides,
  }
}

function renderDialog(editing: CommercialSku | null, onSubmit = vi.fn()) {
  vi.spyOn(api, 'useMasters').mockReturnValue({ data: [] } as never)
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <SkuFormDialog open editing={editing} onClose={() => {}} onSubmit={onSubmit} />
    </QueryClientProvider>,
  )
  return { onSubmit }
}

describe('SkuFormDialog — Base Pricing fields live in Identity', () => {
  it('shows List Price / Minimum Allowed / Default Max Discount % once, outside Set Selling Price', () => {
    renderDialog(sku())
    const identitySection = screen.getByText('Identity').closest('section')!
    expect(within(identitySection).getByLabelText(/^list price/i)).toBeInTheDocument()
    expect(within(identitySection).getByLabelText('Minimum Allowed')).toBeInTheDocument()
    expect(within(identitySection).getByLabelText(/^default max discount %/i)).toBeInTheDocument()
    // Not duplicated as a standalone "Pricing" block anywhere else.
    expect(screen.queryByText(/^pricing$/i)).not.toBeInTheDocument()
  })
})

describe('SkuFormDialog — Set Selling Price', () => {
  it('shows the section with an Add Pricing Level action and no per-level fields yet', () => {
    renderDialog(sku())
    expect(screen.getByText('Set Selling Price')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add pricing level/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/internal selling price/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /internal/i })).not.toBeInTheDocument()
  })

  it('opening Add Pricing Level shows a checkbox per available level and no input fields yet', async () => {
    const user = userEvent.setup()
    renderDialog(sku())
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    expect(await screen.findByRole('checkbox', { name: 'Internal' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Government' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/internal selling price/i)).not.toBeInTheDocument()
  })

  it('checking levels and clicking Add Selected creates one independent card per level, each with its own fields', async () => {
    const user = userEvent.setup()
    renderDialog(sku())
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Internal' }))
    await user.click(screen.getByRole('checkbox', { name: 'Government' }))
    await user.click(screen.getByRole('button', { name: /add selected/i }))

    expect(screen.getByLabelText(/internal selling price/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/internal discount %/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/internal maximum discount %/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/internal margin/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/government selling price/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/government discount %/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/government maximum discount %/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/government margin/i)).toBeInTheDocument()

    // Neither level is offered again in the popover.
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    expect(screen.queryByRole('checkbox', { name: 'Internal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Government' })).not.toBeInTheDocument()
  })

  it("each added level's maximum discount is independent of the others", async () => {
    const user = userEvent.setup()
    renderDialog(sku())
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Internal' }))
    await user.click(screen.getByRole('checkbox', { name: 'Government' }))
    await user.click(screen.getByRole('button', { name: /add selected/i }))

    const internalDiscount = screen.getByLabelText(/internal maximum discount %/i) as HTMLInputElement
    const governmentDiscount = screen.getByLabelText(/government maximum discount %/i) as HTMLInputElement
    await user.clear(internalDiscount)
    await user.type(internalDiscount, '15')

    expect(internalDiscount.value).toBe('15')
    expect(governmentDiscount.value).not.toBe('15')
  })

  it('removing a level card removes just that level, leaving the other untouched', async () => {
    const user = userEvent.setup()
    renderDialog(sku())
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Internal' }))
    await user.click(screen.getByRole('checkbox', { name: 'Government' }))
    await user.click(screen.getByRole('button', { name: /add selected/i }))

    await user.click(screen.getByRole('button', { name: /remove internal/i }))

    expect(screen.queryByLabelText(/internal selling price/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/government selling price/i)).toBeInTheDocument()
    // Internal is offered again in the popover since it's no longer added.
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    expect(await screen.findByRole('checkbox', { name: 'Internal' })).toBeInTheDocument()
  })
})

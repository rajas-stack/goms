import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SellingPriceSection } from './SellingPriceSection'
import type { CommercialSku } from '../types'

function sku(overrides: Partial<CommercialSku> = {}): CommercialSku {
  return {
    id: 's1', skuCode: 'X', name: 'X', categoryId: '', featureId: '', editionId: '', uomId: '', currencyId: '',
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

function setup(props: Partial<Parameters<typeof SellingPriceSection>[0]> = {}) {
  const onChange = vi.fn()
  const baseProps = {
    sku: sku(), bomItems: [], skusById: new Map([['s1', sku()]]),
    pricingLevels: [], activePricingLevel: null, onChange,
    ...props,
  } as Parameters<typeof SellingPriceSection>[0]
  const view = render(<SellingPriceSection {...baseProps} />)
  return { onChange, rerender: (next: Partial<Parameters<typeof SellingPriceSection>[0]>) => view.rerender(<SellingPriceSection {...baseProps} {...next} />) }
}

describe('SellingPriceSection', () => {
  it('shows no pricing-level cards and an Add Pricing Level action when empty', () => {
    setup()
    expect(screen.getByRole('button', { name: /add pricing level/i })).toBeInTheDocument()
    expect(screen.queryByText(/internal/i)).not.toBeInTheDocument()
  })

  it('adds a single selected level and makes it active when it is the first one added', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    await user.click(await screen.findByRole('checkbox', { name: /^internal$/i }))
    await user.click(screen.getByRole('button', { name: /add selected/i }))
    expect(onChange).toHaveBeenCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: null }], activePricingLevel: 'internal',
    })
  })

  it('adds multiple selected levels in one confirming action', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    await user.click(await screen.findByRole('checkbox', { name: /^internal$/i }))
    await user.click(screen.getByRole('checkbox', { name: /^government$/i }))
    await user.click(screen.getByRole('button', { name: /add selected/i }))
    expect(onChange).toHaveBeenCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: null }, { level: 'government', sellingPrice: null }],
      activePricingLevel: 'internal',
    })
  })

  it('does not offer an already-added level again', async () => {
    const user = userEvent.setup()
    setup({ pricingLevels: [{ level: 'internal', sellingPrice: 900 }], activePricingLevel: 'internal' })
    await user.click(screen.getByRole('button', { name: /add pricing level/i }))
    expect(screen.queryByRole('checkbox', { name: /^internal$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^government$/i })).toBeInTheDocument()
  })

  it('shows placeholder text, not 0, for an unset selling price', () => {
    setup({ pricingLevels: [{ level: 'internal', sellingPrice: null }], activePricingLevel: 'internal' })
    const input = screen.getByLabelText(/internal selling price/i) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toMatch(/^e\.g\. \d+$/)
  })

  it('derives and displays discount % against list price as the user types a selling price', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ pricingLevels: [{ level: 'internal', sellingPrice: null }], activePricingLevel: 'internal' })
    const input = screen.getByLabelText(/internal selling price/i)
    await user.type(input, '800')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: 800 }], activePricingLevel: 'internal',
    })
  })

  it('rejects a selling price whose implied discount exceeds maximumDiscountPercent, without calling onChange', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ pricingLevels: [{ level: 'internal', sellingPrice: null }], activePricingLevel: 'internal' })
    const input = screen.getByLabelText(/internal selling price/i)
    await user.type(input, '600') // 40% off, max is 30%
    await user.tab()
    expect(onChange).not.toHaveBeenCalled()
    expect(await screen.findByText(/exceeds this sku's maximum allowed discount/i)).toBeInTheDocument()
  })

  it('back-solves selling price from an edited margin and reports the same validation error path', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ pricingLevels: [{ level: 'internal', sellingPrice: 800 }], activePricingLevel: 'internal' })
    const marginInput = screen.getByLabelText(/internal margin/i)
    await user.clear(marginInput)
    await user.type(marginInput, '50') // cost 400, margin 50% -> price 800 (unchanged, valid)
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: 800 }], activePricingLevel: 'internal',
    })
  })

  it('back-solves selling price from an edited discount % (spec §4.2)', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ pricingLevels: [{ level: 'internal', sellingPrice: 900 }], activePricingLevel: 'internal' })
    const discountInput = screen.getByLabelText(/internal discount/i)
    await user.clear(discountInput)
    await user.type(discountInput, '20') // list 1000, 20% off -> 800
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: 800 }], activePricingLevel: 'internal',
    })
  })

  it('displays a clean selling price with no floating-point noise after a discount back-solve (85000 list, 30% max)', async () => {
    const user = userEvent.setup()
    const bigSku = sku({ listPrice: 85000, maximumDiscountPercent: 30 })
    const { onChange, rerender } = setup({
      sku: bigSku, skusById: new Map([['s1', bigSku]]),
      pricingLevels: [{ level: 'internal', sellingPrice: null }], activePricingLevel: 'internal',
    })
    const discountInput = screen.getByLabelText(/internal discount/i)
    await user.type(discountInput, '30')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: 85000 * 0.7 }], activePricingLevel: 'internal',
    })
    rerender({ pricingLevels: [{ level: 'internal', sellingPrice: 85000 * 0.7 }], activePricingLevel: 'internal' })
    const priceInput = screen.getByLabelText(/internal selling price/i) as HTMLInputElement
    expect(priceInput.value).toBe('59500')
  })

  it('displays a clean selling price with no floating-point noise after a margin back-solve (cost 400, 95% margin)', async () => {
    const user = userEvent.setup()
    const bigSku = sku({ listPrice: 8000, baseSoftwareCost: 400, maximumDiscountPercent: 30 })
    const { onChange, rerender } = setup({
      sku: bigSku, skusById: new Map([['s1', bigSku]]),
      pricingLevels: [{ level: 'internal', sellingPrice: null }], activePricingLevel: 'internal',
    })
    const marginInput = screen.getByLabelText(/internal margin/i)
    await user.type(marginInput, '95') // cost 400 / (1 - 0.95) = 7999.999999999993 in IEEE754
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: 400 / (1 - 95 / 100) }], activePricingLevel: 'internal',
    })
    rerender({ pricingLevels: [{ level: 'internal', sellingPrice: 400 / (1 - 95 / 100) }], activePricingLevel: 'internal' })
    const priceInput = screen.getByLabelText(/internal selling price/i) as HTMLInputElement
    expect(priceInput.value).toBe('8000')
  })

  it('rejects a discount % edit that exceeds maximumDiscountPercent, without calling onChange', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ pricingLevels: [{ level: 'internal', sellingPrice: 900 }], activePricingLevel: 'internal' })
    const discountInput = screen.getByLabelText(/internal discount/i)
    await user.clear(discountInput)
    await user.type(discountInput, '40') // max is 30%
    await user.tab()
    expect(onChange).not.toHaveBeenCalled()
    expect(await screen.findByText(/exceeds this sku's maximum allowed discount/i)).toBeInTheDocument()
  })

  it('keeps two cards\' state fully independent — editing one never touches the other\'s entry', async () => {
    const user = userEvent.setup()
    const levels = [{ level: 'internal' as const, sellingPrice: 900 }, { level: 'government' as const, sellingPrice: 850 }]
    const { onChange } = setup({ pricingLevels: levels, activePricingLevel: 'internal' })
    const discountInput = screen.getByLabelText(/internal discount/i)
    await user.clear(discountInput)
    await user.type(discountInput, '10') // list 1000, 10% off -> 900 (unchanged, valid)
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: 900 }, { level: 'government', sellingPrice: 850 }],
      activePricingLevel: 'internal',
    })
  })

  it('switches the active level via the radio control', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({
      pricingLevels: [{ level: 'internal', sellingPrice: 900 }, { level: 'government', sellingPrice: 850 }],
      activePricingLevel: 'internal',
    })
    await user.click(screen.getByRole('radio', { name: /use government for calculation/i }))
    expect(onChange).toHaveBeenCalledWith({
      pricingLevels: [{ level: 'internal', sellingPrice: 900 }, { level: 'government', sellingPrice: 850 }],
      activePricingLevel: 'government',
    })
  })

  it('accordion: only one pricing-level card is expanded at a time, and clicking another swaps which one', async () => {
    const user = userEvent.setup()
    const levels = [{ level: 'internal' as const, sellingPrice: 900 }, { level: 'government' as const, sellingPrice: 850 }]
    setup({ pricingLevels: levels, activePricingLevel: 'internal' })
    expect(screen.getByLabelText(/internal selling price/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/government selling price/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^government$/i }))
    expect(screen.queryByLabelText(/internal selling price/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/government selling price/i)).toBeInTheDocument()
  })

  it('adding a new pricing level does not expand every existing level', () => {
    const levels = [{ level: 'internal' as const, sellingPrice: 900 }]
    const { rerender } = setup({ pricingLevels: levels, activePricingLevel: 'internal' })
    expect(screen.getByLabelText(/internal selling price/i)).toBeInTheDocument()
    rerender({ pricingLevels: [...levels, { level: 'government', sellingPrice: null }], activePricingLevel: 'internal' })
    expect(screen.getByLabelText(/internal selling price/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/government selling price/i)).not.toBeInTheDocument()
  })

  it('removing the active level clears activePricingLevel and shows an inline prompt rather than silently falling back', async () => {
    const user = userEvent.setup()
    const levels = [{ level: 'internal' as const, sellingPrice: 900 }, { level: 'government' as const, sellingPrice: 850 }]
    const { onChange, rerender } = setup({ pricingLevels: levels, activePricingLevel: 'internal' })
    await user.click(screen.getByRole('button', { name: /remove internal/i }))
    expect(onChange).toHaveBeenCalledWith({ pricingLevels: [levels[1]], activePricingLevel: null })
    // Fully controlled component — simulate the parent applying onChange's result.
    rerender({ pricingLevels: [levels[1]], activePricingLevel: null })
    expect(await screen.findByText(/select a pricing level to use for calculation/i)).toBeInTheDocument()
  })
})

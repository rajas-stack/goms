import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkEditBar } from './BulkEditBar'
import type { CommercialBoqLineItem, CommercialSku } from '../types'

function sku(overrides: Partial<CommercialSku> = {}): CommercialSku {
  return {
    id: 's1', skuCode: 'X', name: 'Widget', categoryId: '', featureId: '', editionId: '', uomId: '', currencyId: '',
    taxClassId: '', billingTypeId: '', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active',
    isSellable: true, displayOrder: 0,
    baseSoftwareCost: 0, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 900, floorPrice: 800, partnerPrice: 950, governmentPrice: 850,
    enterprisePrice: 1100, corporatePrice: 1050, listPrice: 1000,
    minimumAllowedPrice: 500, maximumDiscountPercent: 30,
    createdAt: '', createdBy: null,
    ...overrides,
  }
}

function line(id: string): CommercialBoqLineItem {
  return {
    id, boqId: 'b1', skuId: 's1', quantity: 1, unitPrice: 1000, discountPct: 0, taxPct: 18,
    approverId: null, approvalDate: null, approvalRemarks: '', approvalStatus: 'auto_approved', lineTotal: 1180,
    pricingLevels: [], activePricingLevel: null,
  }
}

describe('BulkEditBar', () => {
  it('lists which lines will be affected before applying', () => {
    render(<BulkEditBar selectedLines={[line('l1'), line('l2')]} skusById={new Map([['s1', sku()]])} onApply={() => {}} />)
    expect(screen.getByText(/2 line/i)).toBeInTheDocument()
  })

  it('applies Set Discount % with a chosen pricing level and reports the computed results', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BulkEditBar selectedLines={[line('l1')]} skusById={new Map([['s1', sku()]])} onApply={onApply} />)
    await user.selectOptions(screen.getByLabelText(/action/i), 'setDiscount')
    await user.selectOptions(screen.getByLabelText(/pricing level/i), 'internal')
    await user.type(screen.getByLabelText(/discount %/i), '20')
    await user.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const [results] = onApply.mock.calls[0]
    expect(results).toHaveLength(1)
    expect(results[0].lineId).toBe('l1')
    expect(results[0].ok).toBe(true)
    expect(results[0].activePricingLevel).toBe('internal')
    expect(results[0].discountPct).toBeCloseTo(20, 1)
  })

  it('reports a line that would exceed the maximum discount as not applied, without throwing', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BulkEditBar selectedLines={[line('l1')]} skusById={new Map([['s1', sku()]])} onApply={onApply} />)
    await user.selectOptions(screen.getByLabelText(/action/i), 'setDiscount')
    await user.selectOptions(screen.getByLabelText(/pricing level/i), 'internal')
    await user.type(screen.getByLabelText(/discount %/i), '50')
    await user.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalledWith([expect.objectContaining({ lineId: 'l1', ok: false })])
  })

  it('applies Clear Discount without requiring a pricing-level selection', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BulkEditBar selectedLines={[line('l1')]} skusById={new Map([['s1', sku()]])} onApply={onApply} />)
    await user.selectOptions(screen.getByLabelText(/action/i), 'clearDiscount')
    await user.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalledWith([expect.objectContaining({ lineId: 'l1', ok: true, activePricingLevel: null, discountPct: 0 })])
  })
})

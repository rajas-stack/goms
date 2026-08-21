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

function renderCreateBoq() {
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
  vi.spyOn(api, 'useSkus').mockReturnValue({ data: [sku()] } as never)
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
  await pickCombobox(user, 'Product', 'GOMS')
  await pickCombobox(user, 'Module', 'Account Mapping')
  await pickCombobox(user, 'Feature', 'Hierarchy Tree')
  await user.click(screen.getByRole('button', { name: /add to proposal/i }))
}

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
})

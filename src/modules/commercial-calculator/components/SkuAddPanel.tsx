import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useMasters } from '../api'
import { skuToBoqConversionFactor } from '../repository-logic'
import { effectiveUnitPrice, resolveLineUnitPrice } from '../pricing-levels-logic'
import { formatPercent } from '../format'
import { SellingPriceSection } from './SellingPriceSection'
import type { CommercialBomItem, CommercialSku, LinePricingLevel, PricingLevelKey } from '../types'

export interface SkuLineDraft {
  skuId: string
  quantity: number
  discountPct: number
  pricingLevels: LinePricingLevel[]
  activePricingLevel: PricingLevelKey | null
}

/** Quantity + Set Selling Price + "Add to Proposal" for one already-resolved
 *  SKU — extracted out of `SkuLinePicker` (BOQ workbench spec §7) so the
 *  cascading Product/Module/Feature picker and the new fast-search bar
 *  converge on identical preview/add behavior instead of duplicating it.
 *  `skusById` must be the FULL SKU map (not just `sku` alone) — margin
 *  calculation needs it to resolve mandatory BOM component costs. Owns its
 *  own quantity/pricing-level state and resets it after a successful add;
 *  the caller owns which SKU is currently resolved. */
export function SkuAddPanel({ sku, skusById, currencyCode, bomItems, onAdd }: {
  sku: CommercialSku
  skusById: Map<string, CommercialSku>
  currencyCode: string
  bomItems: CommercialBomItem[]
  onAdd: (line: SkuLineDraft) => void
}) {
  const { data: taxClasses = [] } = useMasters('taxClasses')
  const { data: currencies = [] } = useMasters('currencies')
  const [qty, setQty] = useState(1)
  const [pricingLevels, setPricingLevels] = useState<LinePricingLevel[]>([])
  const [activePricingLevel, setActivePricingLevel] = useState<PricingLevelKey | null>(null)

  const taxPct = taxClasses.find((t) => t.id === sku.taxClassId)?.ratePct ?? 0
  const factor = currencyCode && currencies.length > 0 ? skuToBoqConversionFactor(currencies, currencyCode, sku) : 1
  const { unitPrice, discountPct, isAbsolutePrice } = resolveLineUnitPrice(sku, 0, pricingLevels, activePricingLevel)
  const previewTotal = qty * effectiveUnitPrice(unitPrice, discountPct, isAbsolutePrice) * (1 + taxPct / 100) * factor

  function handleAdd() {
    onAdd({ skuId: sku.id, quantity: qty, discountPct: 0, pricingLevels, activePricingLevel })
    setQty(1)
    setPricingLevels([])
    setActivePricingLevel(null)
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-[12px] text-muted">
          Generated SKU: <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{sku.skuCode}</span>
          {' '}— {sku.name}
        </p>
        <Field label="Quantity"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-24" /></Field>
        <Button variant="primary" size="sm" onClick={handleAdd}>
          <Icon name="Plus" size={14} />
          Add to Proposal
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-line bg-white px-3 py-2 text-[12px]">
        <span className="text-muted">List Price <span className="font-medium text-ink-900">{sku.listPrice.toLocaleString()}</span></span>
        <span className="text-muted">Post-discount Unit <span className="font-medium text-ink-900">{unitPrice.toLocaleString()}</span></span>
        <span className="text-muted">Discount <span className="font-medium text-ink-900">{formatPercent(discountPct)}</span></span>
        <span className="text-muted">Tax <span className="font-medium text-ink-900">{taxPct}%</span></span>
        <span className="text-muted">
          Line Total (Qty {qty}){' '}
          <span className="font-semibold text-ink-900">{previewTotal.toLocaleString()}</span>
        </span>
      </div>
      <div className="mt-3">
        <SellingPriceSection
          sku={sku}
          bomItems={bomItems}
          skusById={skusById}
          pricingLevels={pricingLevels}
          activePricingLevel={activePricingLevel}
          onChange={(next) => { setPricingLevels(next.pricingLevels); setActivePricingLevel(next.activePricingLevel) }}
        />
      </div>
    </div>
  )
}

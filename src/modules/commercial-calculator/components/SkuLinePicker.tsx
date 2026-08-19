import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Field, Input } from '@/components/ui/Field'
import { useMasters, useSkus } from '../api'
import { skuToBoqConversionFactor } from '../repository-logic'
import { resolveLineUnitPrice } from '../pricing-levels-logic'
import { SellingPriceSection } from './SellingPriceSection'
import type { CommercialBomItem, CommercialSku, LinePricingLevel, PricingLevelKey } from '../types'

interface LineDraft {
  skuId: string
  quantity: number
  discountPct: number
  pricingLevels: LinePricingLevel[]
  activePricingLevel: PricingLevelKey | null
}

/** The cascading Product→Module→Feature→SKU picker, extracted from
 *  `CreateBoq.tsx` so both the initial-creation flow and adding a line to an
 *  existing draft BOQ (`ProposalDetail.tsx`) share one implementation.
 *  Takes the BOQ's already-fixed `verticalId`/`currencyCode` as props —
 *  unlike `CreateBoq.tsx`, where Vertical is itself a top-level field the
 *  user picks once, an existing BOQ's Vertical is fixed, so this component
 *  never owns Vertical selection itself; the caller decides what to render
 *  when there's no Vertical yet (`CreateBoq.tsx` still shows its own "select
 *  a Vertical" message before ever rendering this). */
export function SkuLinePicker({ verticalId, currencyCode, bomItems, onAdd }: {
  verticalId: string
  currencyCode: string
  bomItems: CommercialBomItem[]
  onAdd: (line: LineDraft) => void
}) {
  const { data: products = [] } = useMasters('products')
  const { data: modules = [] } = useMasters('modules')
  const { data: features = [] } = useMasters('features')
  const { data: taxClasses = [] } = useMasters('taxClasses')
  const { data: currencies = [] } = useMasters('currencies')
  const { data: skus = [] } = useSkus()

  const [productId, setProductId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [featureId, setFeatureId] = useState('')
  const [qty, setQty] = useState(1)
  const [pricingLevels, setPricingLevels] = useState<LinePricingLevel[]>([])
  const [activePricingLevel, setActivePricingLevel] = useState<PricingLevelKey | null>(null)

  const sellableSkus = skus.filter((s) => s.lifecycleStatus === 'active' && s.isSellable)
  const taxRateById = new Map(taxClasses.map((t) => [t.id, t.ratePct]))
  const pickerProducts = products.filter((p) => p.verticalId === verticalId)
  const pickerModules = modules.filter((m) => m.productId === productId)
  const pickerFeatures = features.filter((f) => f.moduleId === moduleId)
  const resolvedSku = featureId ? sellableSkus.find((s) => s.featureId === featureId) : undefined
  const featureHasNoSellableSku = !!featureId && !resolvedSku
  const skusById = new Map(skus.map((s) => [s.id, s]))

  function conversionFactorFor(sku: CommercialSku): number {
    if (!currencyCode || currencies.length === 0) return 1
    return skuToBoqConversionFactor(currencies, currencyCode, sku)
  }
  function previewTotal(): number {
    if (!resolvedSku) return 0
    const taxPct = taxRateById.get(resolvedSku.taxClassId) ?? 0
    const { unitPrice, discountPct } = resolveLineUnitPrice(resolvedSku, 0, pricingLevels, activePricingLevel)
    return qty * unitPrice * (1 - discountPct / 100) * (1 + taxPct / 100) * conversionFactorFor(resolvedSku)
  }

  function handleProductChange(v: string) {
    setProductId(v)
    setModuleId('')
    setFeatureId('')
  }
  function handleModuleChange(v: string) {
    setModuleId(v)
    setFeatureId('')
  }

  function handleAdd() {
    if (!resolvedSku) return
    onAdd({ skuId: resolvedSku.id, quantity: qty, discountPct: 0, pricingLevels, activePricingLevel })
    setProductId('')
    setModuleId('')
    setFeatureId('')
    setQty(1)
    setPricingLevels([])
    setActivePricingLevel(null)
  }

  const { unitPrice: previewUnitPrice, discountPct: previewDiscountPct } = resolvedSku
    ? resolveLineUnitPrice(resolvedSku, 0, pricingLevels, activePricingLevel)
    : { unitPrice: 0, discountPct: 0 }

  return (
    <div className="rounded-xl border border-line bg-panel/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Product">
          <Combobox
            value={productId}
            onChange={handleProductChange}
            options={pickerProducts.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
            className="min-w-[180px]"
            aria-label="Product"
          />
        </Field>
        <Field label="Module">
          <Combobox
            value={moduleId}
            onChange={handleModuleChange}
            options={pickerModules.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))}
            className="min-w-[180px]"
            disabled={!productId}
            aria-label="Module"
          />
        </Field>
        <Field label="Feature">
          <Combobox
            value={featureId}
            onChange={setFeatureId}
            options={pickerFeatures.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }))}
            className="min-w-[180px]"
            disabled={!moduleId}
            aria-label="Feature"
          />
        </Field>
        <Field label="Quantity"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-24" /></Field>
        <Button variant="primary" size="sm" onClick={handleAdd} disabled={!resolvedSku}>
          <Icon name="Plus" size={14} />
          Add to Proposal
        </Button>
      </div>

      {resolvedSku && (
        <>
          <p className="mt-2 text-[12px] text-muted">
            Generated SKU: <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{resolvedSku.skuCode}</span>
            {' '}— {resolvedSku.name}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-line bg-white px-3 py-2 text-[12px]">
            <span className="text-muted">List Price <span className="font-medium text-ink-900">{resolvedSku.listPrice.toLocaleString()}</span></span>
            <span className="text-muted">Post-discount Unit <span className="font-medium text-ink-900">{previewUnitPrice.toLocaleString()}</span></span>
            <span className="text-muted">Discount <span className="font-medium text-ink-900">{previewDiscountPct.toFixed(1)}%</span></span>
            <span className="text-muted">Tax <span className="font-medium text-ink-900">{taxRateById.get(resolvedSku.taxClassId) ?? 0}%</span></span>
            <span className="text-muted">
              Line Total (Qty {qty}){' '}
              <span className="font-semibold text-ink-900">{previewTotal().toLocaleString()}</span>
            </span>
          </div>
          <div className="mt-3">
            <SellingPriceSection
              sku={resolvedSku}
              bomItems={bomItems}
              skusById={skusById}
              pricingLevels={pricingLevels}
              activePricingLevel={activePricingLevel}
              onChange={(next) => { setPricingLevels(next.pricingLevels); setActivePricingLevel(next.activePricingLevel) }}
            />
          </div>
        </>
      )}
      {featureHasNoSellableSku && (
        <p className="mt-2 text-[12px] text-amber-700">No active, sellable SKU exists for this feature yet.</p>
      )}
    </div>
  )
}

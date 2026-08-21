import { useState } from 'react'
import { Combobox } from '@/components/ui/Combobox'
import { Field } from '@/components/ui/Field'
import { useMasters, useSkus } from '../api'
import { SkuAddPanel, type SkuLineDraft } from './SkuAddPanel'
import type { CommercialBomItem } from '../types'

/** The cascading Product->Module->Feature->SKU picker, extracted from
 *  `CreateBoq.tsx` so both the initial-creation flow and adding a line to an
 *  existing draft BOQ (`ProposalDetail.tsx`) share one implementation.
 *  Quantity/pricing/preview/add now live in `SkuAddPanel` (BOQ workbench
 *  spec §7) — this component's own job is resolving a SKU from the
 *  cascading selection and resetting that selection after an add. Takes the
 *  BOQ's already-fixed `verticalId`/`currencyCode` as props — unlike
 *  `CreateBoq.tsx`, where Vertical is itself a top-level field the user
 *  picks once, an existing BOQ's Vertical is fixed. */
export function SkuLinePicker({ verticalId, currencyCode, bomItems, onAdd }: {
  verticalId: string
  currencyCode: string
  bomItems: CommercialBomItem[]
  onAdd: (line: SkuLineDraft) => void
}) {
  const { data: products = [] } = useMasters('products')
  const { data: modules = [] } = useMasters('modules')
  const { data: features = [] } = useMasters('features')
  const { data: skus = [] } = useSkus()

  const [productId, setProductId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [featureId, setFeatureId] = useState('')

  const sellableSkus = skus.filter((s) => s.lifecycleStatus === 'active' && s.isSellable)
  const pickerProducts = products.filter((p) => p.verticalId === verticalId)
  const pickerModules = modules.filter((m) => m.productId === productId)
  const pickerFeatures = features.filter((f) => f.moduleId === moduleId)
  const resolvedSku = featureId ? sellableSkus.find((s) => s.featureId === featureId) : undefined
  const featureHasNoSellableSku = !!featureId && !resolvedSku
  const skusById = new Map(skus.map((s) => [s.id, s]))

  function handleProductChange(v: string) {
    setProductId(v)
    setModuleId('')
    setFeatureId('')
  }
  function handleModuleChange(v: string) {
    setModuleId(v)
    setFeatureId('')
  }
  function handleAdd(line: SkuLineDraft) {
    onAdd(line)
    setProductId('')
    setModuleId('')
    setFeatureId('')
  }

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
      </div>

      {resolvedSku && (
        <div className="mt-3">
          <SkuAddPanel sku={resolvedSku} skusById={skusById} currencyCode={currencyCode} bomItems={bomItems} onAdd={handleAdd} />
        </div>
      )}
      {featureHasNoSellableSku && (
        <p className="mt-2 text-[12px] text-amber-700">No active, sellable SKU exists for this feature yet.</p>
      )}
    </div>
  )
}

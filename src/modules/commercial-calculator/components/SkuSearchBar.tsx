import { useState } from 'react'
import { Field, Input } from '@/components/ui/Field'
import { useMasters, useSkus } from '../api'
import { SkuAddPanel, type SkuLineDraft } from './SkuAddPanel'
import type { CommercialBomItem, CommercialSku } from '../types'

/** Persistent, always-visible search by SKU code or name — the fast path
 *  for a user who already knows the SKU (BOQ workbench spec §7); zero
 *  clicks to start typing, unlike the cascading Product/Module/Feature
 *  picker retained separately as "Browse Catalog". `CommercialSku` has no
 *  direct verticalId — it's resolved via featureId -> module -> product, the
 *  same chain `SkuLinePicker` already walks via its Product combobox. */
export function SkuSearchBar({ verticalId, currencyCode, bomItems, existingSkuIds, onAdd }: {
  verticalId: string
  currencyCode: string
  bomItems: CommercialBomItem[]
  /** SKU ids already on this BOQ — drives the non-blocking "already in the
   *  BOQ" warning shown once a SKU is picked here (BOQ workbench QA pass). */
  existingSkuIds?: Set<string>
  onAdd: (line: SkuLineDraft) => void
}) {
  const { data: skus = [] } = useSkus()
  const { data: products = [] } = useMasters('products')
  const { data: modules = [] } = useMasters('modules')
  const { data: features = [] } = useMasters('features')
  const [query, setQuery] = useState('')
  const [selectedSkuId, setSelectedSkuId] = useState('')

  const moduleById = new Map(modules.map((m) => [m.id, m]))
  const productById = new Map(products.map((p) => [p.id, p]))
  const featureById = new Map(features.map((f) => [f.id, f]))

  function skuVerticalId(sku: CommercialSku): string | undefined {
    const feature = featureById.get(sku.featureId)
    const module_ = feature ? moduleById.get(feature.moduleId) : undefined
    const product = module_ ? productById.get(module_.productId) : undefined
    return product?.verticalId
  }

  const sellableSkus = skus.filter((s) => s.lifecycleStatus === 'active' && s.isSellable && skuVerticalId(s) === verticalId)
  const normalizedQuery = query.trim().toLowerCase()
  const results = normalizedQuery.length === 0
    ? []
    : sellableSkus.filter((s) => s.skuCode.toLowerCase().includes(normalizedQuery) || s.name.toLowerCase().includes(normalizedQuery)).slice(0, 8)
  const selectedSku = sellableSkus.find((s) => s.id === selectedSkuId)
  const skusById = new Map(skus.map((s) => [s.id, s]))

  function handleAdd(line: SkuLineDraft) {
    onAdd(line)
    setQuery('')
    setSelectedSkuId('')
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') setQuery('')
  }

  return (
    <div className="rounded-xl border border-line bg-panel/40 p-3">
      <Field label="Search by SKU code or name">
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedSkuId('') }}
          onKeyDown={handleSearchKeyDown}
          placeholder="Type a SKU code or product name…"
          aria-label="Search by SKU code or name"
        />
      </Field>
      {sellableSkus.length === 0 && (
        <p className="mt-2 text-[12px] text-amber-700">No SKUs are configured for this Vertical yet — add one in the SKU Catalog first.</p>
      )}
      {sellableSkus.length > 0 && normalizedQuery.length > 0 && !selectedSku && (
        <ul className="mt-2 flex flex-col gap-1 rounded-lg border border-line bg-white p-1">
          {results.length === 0 ? (
            <li className="px-2 py-1.5 text-[12px] text-muted">No SKU matches your search.</li>
          ) : results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelectedSkuId(s.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-ink-900/[0.05]"
              >
                <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{s.skuCode}</span>
                <span className="truncate">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedSku && (
        <div className="mt-3">
          <SkuAddPanel
            sku={selectedSku}
            skusById={skusById}
            currencyCode={currencyCode}
            bomItems={bomItems}
            alreadyInBoq={existingSkuIds?.has(selectedSku.id)}
            onAdd={handleAdd}
          />
        </div>
      )}
    </div>
  )
}

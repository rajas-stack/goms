import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { PRICING_LEVEL_KEYS, PRICING_LEVEL_LABEL, computeBulkClearDiscount, computeBulkSetDiscount, computeBulkSetSellingPrice } from '../pricing-levels-logic'
import type { BulkPricingResult } from '../pricing-levels-logic'
import type { CommercialBoqLineItem, CommercialSku, PricingLevelKey } from '../types'

type Action = 'setDiscount' | 'setSellingPrice' | 'clearDiscount'

/** Shows which lines are selected, lets the user pick one bulk action, and
 *  computes the per-line result set via the same validated pure logic a
 *  single-line edit uses — it never mutates anything itself; the caller
 *  applies each `ok: true` result and reports the `ok: false` ones
 *  (spec §10: "clearly show which lines will be affected before applying"). */
export function BulkEditBar({ selectedLines, skusById, onApply }: {
  selectedLines: CommercialBoqLineItem[]
  skusById: Map<string, CommercialSku>
  onApply: (results: BulkPricingResult[]) => void
}) {
  const [action, setAction] = useState<Action>('setDiscount')
  const [level, setLevel] = useState<PricingLevelKey>('internal')
  const [value, setValue] = useState('')

  function apply() {
    const numeric = Number(value)
    let results: BulkPricingResult[]
    if (action === 'clearDiscount') {
      results = computeBulkClearDiscount(selectedLines, skusById)
    } else if (action === 'setDiscount') {
      results = computeBulkSetDiscount(selectedLines, skusById, level, numeric)
    } else {
      results = computeBulkSetSellingPrice(selectedLines, skusById, level, numeric)
    }
    onApply(results)
  }

  const needsValue = action !== 'clearDiscount'
  const canApply = selectedLines.length > 0 && (!needsValue || (value.trim() !== '' && Number.isFinite(Number(value))))

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-900/20 bg-ink-900/[0.03] p-3">
      <p className="text-[13px] font-medium text-ink-900">{selectedLines.length} line{selectedLines.length === 1 ? '' : 's'} selected</p>
      <Field label="Action">
        <Select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value as Action)} className="w-44">
          <option value="setDiscount">Set Discount %</option>
          <option value="setSellingPrice">Set Selling Price</option>
          <option value="clearDiscount">Clear Discount</option>
        </Select>
      </Field>
      {needsValue && (
        <>
          <Field label="Pricing Level">
            <Select aria-label="Pricing Level" value={level} onChange={(e) => setLevel(e.target.value as PricingLevelKey)} className="w-40">
              {PRICING_LEVEL_KEYS.map((k) => <option key={k} value={k}>{PRICING_LEVEL_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label={action === 'setDiscount' ? 'Discount %' : 'Selling Price'}>
            <Input
              type="number"
              aria-label={action === 'setDiscount' ? 'Discount %' : 'Selling Price'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-32"
            />
          </Field>
        </>
      )}
      <Button variant="primary" size="sm" onClick={apply} disabled={!canApply}>Apply</Button>
    </div>
  )
}

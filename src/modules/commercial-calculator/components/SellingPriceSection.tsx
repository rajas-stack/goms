import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Menu, MenuItem } from '@/components/ui/Menu'
import {
  PRICING_LEVEL_KEYS, PRICING_LEVEL_LABEL, PricingValidationError, discountPctForSellingPrice,
  marginPctForSellingPrice, removePricingLevel, sellingPriceForMargin, skuPriceForLevel, upsertPricingLevel,
  validateSellingPrice,
} from '../pricing-levels-logic'
import type { CommercialBomItem, CommercialSku, LinePricingLevel, PricingLevelKey } from '../types'

interface Props {
  sku: CommercialSku
  bomItems: CommercialBomItem[]
  skusById: Map<string, CommercialSku>
  pricingLevels: LinePricingLevel[]
  activePricingLevel: PricingLevelKey | null
  onChange: (next: { pricingLevels: LinePricingLevel[]; activePricingLevel: PricingLevelKey | null }) => void
}

/** Fully controlled — holds no state of its own beyond per-card local edit
 *  buffers and error messages. The caller (a live BOQ line in
 *  `ProposalDetail.tsx`, or an in-progress draft line in `CreateBoq.tsx`)
 *  decides what `onChange` actually does (spec §3). */
export function SellingPriceSection({ sku, bomItems, skusById, pricingLevels, activePricingLevel, onChange }: Props) {
  const availableLevels = PRICING_LEVEL_KEYS.filter((k) => !pricingLevels.some((l) => l.level === k))
  const showReselectPrompt = pricingLevels.length > 0 && activePricingLevel === null

  function addLevel(level: PricingLevelKey) {
    const next = upsertPricingLevel(pricingLevels, level, null)
    onChange({ pricingLevels: next, activePricingLevel: activePricingLevel ?? level })
  }

  function removeLevel(level: PricingLevelKey) {
    const next = removePricingLevel(pricingLevels, level)
    onChange({ pricingLevels: next, activePricingLevel: activePricingLevel === level ? null : activePricingLevel })
  }

  function setActive(level: PricingLevelKey) {
    onChange({ pricingLevels, activePricingLevel: level })
  }

  function setSellingPrice(level: PricingLevelKey, sellingPrice: number) {
    validateSellingPrice(sku, sellingPrice) // throws PricingValidationError — caller (the card) catches it
    onChange({ pricingLevels: upsertPricingLevel(pricingLevels, level, sellingPrice), activePricingLevel })
  }

  function setMargin(level: PricingLevelKey, marginPct: number) {
    const sellingPrice = sellingPriceForMargin(sku, bomItems, skusById, marginPct) // throws PricingValidationError
    onChange({ pricingLevels: upsertPricingLevel(pricingLevels, level, sellingPrice), activePricingLevel })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Selling Price</h4>
        <Menu
          trigger={({ toggle }) => (
            <Button size="sm" onClick={toggle} disabled={availableLevels.length === 0}>
              <Icon name="Plus" size={13} />
              Add Pricing Level
            </Button>
          )}
        >
          {(close) => (
            <>
              {availableLevels.map((level) => (
                <MenuItem key={level} onClick={() => { addLevel(level); close() }}>
                  {PRICING_LEVEL_LABEL[level]}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      </div>

      {showReselectPrompt && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          Select a pricing level to use for calculation, or this line uses List Price with no discount.
        </p>
      )}

      {pricingLevels.length === 0 ? (
        <p className="text-[12px] text-muted">No pricing levels added — this line uses List Price with no discount.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {pricingLevels.map((entry) => (
            <PricingLevelCard
              key={entry.level}
              sku={sku}
              bomItems={bomItems}
              skusById={skusById}
              entry={entry}
              active={entry.level === activePricingLevel}
              onSetActive={() => setActive(entry.level)}
              onRemove={() => removeLevel(entry.level)}
              onSetSellingPrice={(v) => setSellingPrice(entry.level, v)}
              onSetMargin={(v) => setMargin(entry.level, v)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PricingLevelCard({ sku, bomItems, skusById, entry, active, onSetActive, onRemove, onSetSellingPrice, onSetMargin }: {
  sku: CommercialSku
  bomItems: CommercialBomItem[]
  skusById: Map<string, CommercialSku>
  entry: LinePricingLevel
  active: boolean
  onSetActive: () => void
  onRemove: () => void
  onSetSellingPrice: (v: number) => void
  onSetMargin: (v: number) => void
}) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState(entry.sellingPrice === null ? '' : String(entry.sellingPrice))
  const currentMargin = entry.sellingPrice === null ? null : marginPctForSellingPrice(sku, bomItems, skusById, entry.sellingPrice)
  const [marginDraft, setMarginDraft] = useState(currentMargin === null ? '' : currentMargin.toFixed(1))
  const label = PRICING_LEVEL_LABEL[entry.level]

  function commitPrice() {
    const next = Number(priceDraft)
    setError(null)
    if (priceDraft.trim() === '' || !Number.isFinite(next)) return
    try {
      onSetSellingPrice(next)
    } catch (e) {
      setError(e instanceof PricingValidationError ? e.message : 'Could not save this price.')
      setPriceDraft(entry.sellingPrice === null ? '' : String(entry.sellingPrice))
    }
  }

  function commitMargin() {
    const next = Number(marginDraft)
    setError(null)
    if (marginDraft.trim() === '' || !Number.isFinite(next)) return
    try {
      onSetMargin(next)
    } catch (e) {
      setError(e instanceof PricingValidationError ? e.message : 'Could not save this margin.')
      setMarginDraft(currentMargin === null ? '' : currentMargin.toFixed(1))
    }
  }

  const discountPct = entry.sellingPrice === null ? null : discountPctForSellingPrice(sku.listPrice, entry.sellingPrice)

  return (
    <div className="rounded-xl border border-line bg-panel/30 p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-medium text-ink-800">
          <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} />
          {label}
        </button>
        <label className="ml-2 flex items-center gap-1.5 text-[12px] text-ink-700">
          <input type="radio" checked={active} onChange={onSetActive} aria-label={`Use ${label} for calculation`} className="accent-ink-900" />
          Use for calculation
        </label>
        <Button size="icon" className="ml-auto" onClick={onRemove} title={`Remove ${label}`} aria-label={`Remove ${label}`}>
          <Icon name="X" size={13} />
        </Button>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-3 gap-3">
          <Field label={`${label} Selling Price`}>
            <Input
              type="number"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
              onBlur={commitPrice}
              placeholder={`Enter selling price (e.g. ${skuPriceForLevel(sku, entry.level)})`}
              aria-label={`${label} Selling Price`}
            />
          </Field>
          <Field label={`${label} Discount %`}>
            <p className="flex h-10 items-center rounded-lg border border-line bg-panel px-3 text-sm text-ink-700">
              {discountPct === null ? '—' : `${discountPct.toFixed(1)}%`}
            </p>
          </Field>
          <Field label={`${label} Margin %`}>
            <Input
              type="number"
              value={marginDraft}
              onChange={(e) => setMarginDraft(e.target.value)}
              onBlur={commitMargin}
              placeholder="Enter target margin"
              aria-label={`${label} Margin`}
            />
          </Field>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-rose-700">{error}</p>}
    </div>
  )
}

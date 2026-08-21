import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Collapsible } from '@/components/ui/Collapsible'
import { Field, Input } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import {
  PRICING_LEVEL_KEYS, PRICING_LEVEL_LABEL, PricingValidationError, discountPctForSellingPrice,
  marginPctForSellingPrice, maxDiscountPercentForLevel, removePricingLevel, sellingPriceForDiscountPct,
  sellingPriceForMargin, skuPriceForLevel, upsertPricingLevel, validateSellingPrice,
} from '../pricing-levels-logic'
import { roundMoney } from '../format'
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
  const [pendingAdd, setPendingAdd] = useState<PricingLevelKey[]>([])
  // Accordion: only one pricing-level card is expanded at a time. Kept here
  // (not in the card) so adding a level doesn't leave every existing card's
  // own `useState(true)` default expanded — the previous per-card local
  // state bug this replaces.
  const [expandedLevel, setExpandedLevel] = useState<PricingLevelKey | null>(null)
  const effectiveExpandedLevel = pricingLevels.some((l) => l.level === expandedLevel) ? expandedLevel : pricingLevels[0]?.level ?? null

  function toggleQueued(level: PricingLevelKey) {
    setPendingAdd((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]))
  }

  function confirmAdd(close: () => void) {
    if (pendingAdd.length === 0) return
    let nextLevels = pricingLevels
    for (const level of pendingAdd) nextLevels = upsertPricingLevel(nextLevels, level, null)
    onChange({ pricingLevels: nextLevels, activePricingLevel: activePricingLevel ?? pendingAdd[0] })
    setPendingAdd([])
    close()
  }

  function removeLevel(level: PricingLevelKey) {
    const next = removePricingLevel(pricingLevels, level)
    onChange({ pricingLevels: next, activePricingLevel: activePricingLevel === level ? null : activePricingLevel })
  }

  function setActive(level: PricingLevelKey) {
    onChange({ pricingLevels, activePricingLevel: level })
  }

  function setSellingPrice(level: PricingLevelKey, sellingPrice: number) {
    validateSellingPrice(sku, sellingPrice, level) // throws PricingValidationError — caller (the card) catches it
    onChange({ pricingLevels: upsertPricingLevel(pricingLevels, level, sellingPrice), activePricingLevel })
  }

  function setMargin(level: PricingLevelKey, marginPct: number) {
    const sellingPrice = sellingPriceForMargin(sku, bomItems, skusById, marginPct, level) // throws PricingValidationError
    onChange({ pricingLevels: upsertPricingLevel(pricingLevels, level, sellingPrice), activePricingLevel })
  }

  return (
    <Collapsible title="Set Selling Price" icon="Tag">
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <Menu
            trigger={({ toggle }) => (
              <Button size="sm" onClick={() => { setPendingAdd([]); toggle() }} disabled={availableLevels.length === 0}>
                <Icon name="Plus" size={13} />
                Add Pricing Level
              </Button>
            )}
          >
            {(close) => (
              <div className="flex min-w-[12rem] flex-col gap-1 p-1">
                {availableLevels.map((level) => (
                  <label key={level} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink hover:bg-ink-900/[0.05]">
                    <Checkbox checked={pendingAdd.includes(level)} onChange={() => toggleQueued(level)} aria-label={PRICING_LEVEL_LABEL[level]} />
                    {PRICING_LEVEL_LABEL[level]}
                  </label>
                ))}
                <div className="mt-1 border-t border-line pt-1">
                  <Button size="sm" variant="primary" onClick={() => confirmAdd(close)} disabled={pendingAdd.length === 0} className="w-full justify-center">
                    Add Selected
                  </Button>
                </div>
              </div>
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
                open={entry.level === effectiveExpandedLevel}
                onExpand={() => setExpandedLevel(entry.level)}
                onSetActive={() => setActive(entry.level)}
                onRemove={() => removeLevel(entry.level)}
                onSetSellingPrice={(v) => setSellingPrice(entry.level, v)}
                onSetMargin={(v) => setMargin(entry.level, v)}
              />
            ))}
          </div>
        )}
      </div>
    </Collapsible>
  )
}

function PricingLevelCard({ sku, bomItems, skusById, entry, active, open, onExpand, onSetActive, onRemove, onSetSellingPrice, onSetMargin }: {
  sku: CommercialSku
  bomItems: CommercialBomItem[]
  skusById: Map<string, CommercialSku>
  entry: LinePricingLevel
  active: boolean
  open: boolean
  onExpand: () => void
  onSetActive: () => void
  onRemove: () => void
  onSetSellingPrice: (v: number) => void
  onSetMargin: (v: number) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState(entry.sellingPrice === null ? '' : String(roundMoney(entry.sellingPrice)))
  const currentMargin = entry.sellingPrice === null ? null : marginPctForSellingPrice(sku, bomItems, skusById, entry.sellingPrice)
  const [marginDraft, setMarginDraft] = useState(currentMargin === null ? '' : currentMargin.toFixed(1))
  const discountPct = entry.sellingPrice === null ? null : discountPctForSellingPrice(sku.listPrice, entry.sellingPrice)
  const [discountDraft, setDiscountDraft] = useState(discountPct === null ? '' : discountPct.toFixed(1))
  const label = PRICING_LEVEL_LABEL[entry.level]

  // Selling Price / Discount % / Margin % are three views onto the same
  // stored `entry.sellingPrice` (spec §4.2) — whichever field the user just
  // committed already matches this effect's result, but the other two only
  // ever get their value from local `useState` initializers, so without this
  // they'd stay stuck at their pre-edit numbers until the card unmounts.
  useEffect(() => {
    setPriceDraft(entry.sellingPrice === null ? '' : String(roundMoney(entry.sellingPrice)))
    setDiscountDraft(entry.sellingPrice === null ? '' : discountPctForSellingPrice(sku.listPrice, entry.sellingPrice).toFixed(1))
    setMarginDraft(entry.sellingPrice === null ? '' : marginPctForSellingPrice(sku, bomItems, skusById, entry.sellingPrice).toFixed(1))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.sellingPrice])

  function commitPrice() {
    const next = Number(priceDraft)
    setError(null)
    if (priceDraft.trim() === '' || !Number.isFinite(next)) return
    try {
      onSetSellingPrice(next)
    } catch (e) {
      setError(e instanceof PricingValidationError ? e.message : 'Could not save this price.')
      setPriceDraft(entry.sellingPrice === null ? '' : String(roundMoney(entry.sellingPrice)))
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

  function commitDiscount() {
    const next = Number(discountDraft)
    setError(null)
    if (discountDraft.trim() === '' || !Number.isFinite(next)) return
    try {
      onSetSellingPrice(sellingPriceForDiscountPct(sku.listPrice, next))
    } catch (e) {
      setError(e instanceof PricingValidationError ? e.message : 'Could not save this discount.')
      setDiscountDraft(discountPct === null ? '' : discountPct.toFixed(1))
    }
  }

  const maxDiscountPct = maxDiscountPercentForLevel(sku, entry.level)

  return (
    <div className="rounded-xl border border-line bg-panel/30 p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onExpand} className="flex items-center gap-1.5 text-[13px] font-medium text-ink-800">
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
        <div className="mt-2 grid grid-cols-4 gap-3">
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
            <Input
              type="number"
              value={discountDraft}
              onChange={(e) => setDiscountDraft(e.target.value)}
              onBlur={commitDiscount}
              placeholder="Enter target discount"
              aria-label={`${label} Discount %`}
            />
          </Field>
          <Field label={`${label} Maximum Discount %`}>
            <p className="flex h-10 items-center rounded-lg border border-line bg-panel px-3 text-sm text-ink-700">
              {maxDiscountPct}%
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

import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Collapsible } from '@/components/ui/Collapsible'
import { Field, Input, Select } from '@/components/ui/Field'
import { FriendlyDateInput } from '@/components/ui/FriendlyDateInput'
import { Icon } from '@/components/ui/Icon'
import { Menu } from '@/components/ui/Menu'
import { useMasters } from '../api'
import { roundMoney } from '../format'
import {
  discountPctForSellingPrice, marginPctForSellingPrice, PricingValidationError,
  PRICING_LEVEL_KEYS, PRICING_LEVEL_LABEL, sellingPriceForDiscountPct, sellingPriceForMargin, validateSellingPrice,
} from '../pricing-levels-logic'
import { isoToday } from '@/lib/dates'
import type { CommercialSku, CreateSkuInput, PricingLevelKey, SkuPricingLevelSetting } from '../types'

type Values = {
  name: string; categoryId: string; featureId: string; editionId: string; uomId: string; currencyId: string
  taxClassId: string; billingTypeId: string; activeFrom: string; activeTill: string
  lifecycleStatus: CommercialSku['lifecycleStatus']; isSellable: boolean
  baseSoftwareCost: number; implementationCostPerMM: number; integrationCost: number; thirdPartyCost: number
  hardwareCost: number; cloudCost: number; supportCost: number; trainingCost: number
  internalPrice: number; floorPrice: number; partnerPrice: number; governmentPrice: number
  enterprisePrice: number; corporatePrice: number; listPrice: number
  minimumAllowedPrice: number; maximumDiscountPercent: number
  selectedPricingLevels: SkuPricingLevelSetting[]
}

type LevelPriceField = 'internalPrice' | 'floorPrice' | 'partnerPrice' | 'governmentPrice' | 'enterprisePrice' | 'corporatePrice'

/** Maps each pricing level to the SKU's existing flat tier-price field — the
 *  Selling Price a level's card edits is that field, unchanged in storage;
 *  only whether the level is enabled, and its own max discount, are new. */
const LEVEL_PRICE_FIELD: Record<PricingLevelKey, LevelPriceField> = {
  internal: 'internalPrice', floor: 'floorPrice', partner: 'partnerPrice',
  government: 'governmentPrice', enterprise: 'enterprisePrice', corporate: 'corporatePrice',
}

function defaults(existing: CommercialSku | null): Values {
  if (existing) {
    return {
      name: existing.name, categoryId: existing.categoryId, featureId: existing.featureId, editionId: existing.editionId,
      uomId: existing.uomId, currencyId: existing.currencyId, taxClassId: existing.taxClassId,
      billingTypeId: existing.billingTypeId, activeFrom: existing.activeFrom, activeTill: existing.activeTill ?? '',
      lifecycleStatus: existing.lifecycleStatus, isSellable: existing.isSellable,
      baseSoftwareCost: existing.baseSoftwareCost, implementationCostPerMM: existing.implementationCostPerMM,
      integrationCost: existing.integrationCost, thirdPartyCost: existing.thirdPartyCost,
      hardwareCost: existing.hardwareCost, cloudCost: existing.cloudCost, supportCost: existing.supportCost,
      trainingCost: existing.trainingCost, internalPrice: existing.internalPrice, floorPrice: existing.floorPrice,
      partnerPrice: existing.partnerPrice, governmentPrice: existing.governmentPrice,
      enterprisePrice: existing.enterprisePrice, corporatePrice: existing.corporatePrice, listPrice: existing.listPrice,
      minimumAllowedPrice: existing.minimumAllowedPrice, maximumDiscountPercent: existing.maximumDiscountPercent,
      selectedPricingLevels: existing.selectedPricingLevels,
    }
  }
  return {
    name: '', categoryId: '', featureId: '', editionId: '', uomId: '', currencyId: '', taxClassId: '', billingTypeId: '',
    activeFrom: isoToday(), activeTill: '', lifecycleStatus: 'draft', isSellable: true,
    baseSoftwareCost: 0, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 0, floorPrice: 0, partnerPrice: 0, governmentPrice: 0, enterprisePrice: 0, corporatePrice: 0, listPrice: 0,
    minimumAllowedPrice: 0, maximumDiscountPercent: 90, selectedPricingLevels: [],
  }
}

/** SKU is richer than a master row (30+ fields across identity/cost/pricing),
 *  so unlike the 12 masters it gets its own dedicated form rather than the
 *  generic MasterFormDialog engine. */
const SENSITIVE_FIELDS: (keyof Values)[] = [
  'lifecycleStatus', 'baseSoftwareCost', 'implementationCostPerMM', 'integrationCost', 'thirdPartyCost',
  'hardwareCost', 'cloudCost', 'supportCost', 'trainingCost', 'internalPrice', 'floorPrice', 'partnerPrice',
  'governmentPrice', 'enterprisePrice', 'corporatePrice', 'listPrice', 'minimumAllowedPrice', 'maximumDiscountPercent',
]

export function SkuFormDialog({ open, onClose, editing, onSubmit }: {
  open: boolean
  onClose: () => void
  editing: CommercialSku | null
  onSubmit: (input: CreateSkuInput | Partial<CommercialSku>, changeReason?: string) => Promise<void>
}) {
  const [values, setValues] = useState<Values>(() => defaults(editing))
  const [changeReason, setChangeReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const { data: categories = [] } = useMasters('skuCategories')
  const { data: features = [] } = useMasters('features')
  const { data: editions = [] } = useMasters('productEditions')
  const { data: uoms = [] } = useMasters('unitsOfMeasure')
  const { data: currencies = [] } = useMasters('currencies')
  const { data: taxClasses = [] } = useMasters('taxClasses')
  const { data: billingTypes = [] } = useMasters('billingTypes')

  useEffect(() => {
    if (open) {
      setValues(defaults(editing))
      setChangeReason('')
      setError(null)
    }
  }, [open, editing])

  const set = <K extends keyof Values>(key: K, v: Values[K]) => setValues((prev) => ({ ...prev, [key]: v }))

  // Cost/pricing/lifecycle edits require an audit reason (spec §15/§6.6) —
  // creation doesn't, since nothing has changed yet to explain.
  const original = editing ? defaults(editing) : null
  const touchedSensitiveField = !!original && SENSITIVE_FIELDS.some((f) => values[f] !== original[f])

  // A placeholder base when creating (no `editing` row to spread fields
  // like `id`/`skuCode`/`createdAt` from yet) — irrelevant to the pricing
  // math itself, just enough to satisfy the pricing-level helpers' shape
  // so every preview here shares the same live values rather than a
  // hand-rolled second copy of each formula.
  const previewSku = {
    ...(editing ?? { id: '', skuCode: '', createdAt: '', createdBy: null }),
    ...values,
    activeTill: values.activeTill || null,
  } as CommercialSku

  async function submit() {
    setPending(true)
    setError(null)
    try {
      await onSubmit(
        { ...values, activeTill: values.activeTill || null } as never,
        touchedSensitiveField ? changeReason : undefined,
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setPending(false)
    }
  }

  const canSubmit = values.name.trim().length > 0 && values.categoryId && values.featureId && values.uomId
    && values.currencyId && values.taxClassId && values.billingTypeId
    && (!touchedSensitiveField || changeReason.trim().length > 0)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit SKU — ${editing.skuCode}` : 'Add SKU'}
      description={editing ? undefined : 'The SKU code is generated automatically from the feature\'s hierarchy and status.'}
      size="xl"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={pending || !canSubmit}>{pending ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Identity</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" required><Input value={values.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="List Price" hint="Reference price each pricing level's Discount % is computed against.">
              <Input
                type="number"
                value={values.listPrice === 0 ? '' : values.listPrice}
                onChange={(e) => set('listPrice', e.target.value === '' ? 0 : Number(e.target.value))}
                placeholder="e.g. 50000"
              />
            </Field>
            <Field label="SKU Category" required>
              <Select value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </Select>
            </Field>
            <Field label="Feature" hint="Determines the generated SKU code." required>
              <Select value={values.featureId} onChange={(e) => set('featureId', e.target.value)}>
                <option value="">Select…</option>
                {features.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
              </Select>
            </Field>
            <Field label="Product Edition">
              <Select value={values.editionId} onChange={(e) => set('editionId', e.target.value)}>
                <option value="">Standard (default)</option>
                {editions.map((e) => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
              </Select>
            </Field>
            <Field label="Unit of Measure" required>
              <Select value={values.uomId} onChange={(e) => set('uomId', e.target.value)}>
                <option value="">Select…</option>
                {uoms.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </Select>
            </Field>
            <Field label="Currency" required>
              <Select value={values.currencyId} onChange={(e) => set('currencyId', e.target.value)}>
                <option value="">Select…</option>
                {currencies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </Select>
            </Field>
            <Field label="Tax Class" required>
              <Select value={values.taxClassId} onChange={(e) => set('taxClassId', e.target.value)}>
                <option value="">Select…</option>
                {taxClasses.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
              </Select>
            </Field>
            <Field label="Billing Type" required>
              <Select value={values.billingTypeId} onChange={(e) => set('billingTypeId', e.target.value)}>
                <option value="">Select…</option>
                {billingTypes.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </Select>
            </Field>
            <Field label="Active From"><FriendlyDateInput value={values.activeFrom} onChange={(v) => set('activeFrom', v)} /></Field>
            <Field label="Active Till" hint="Leave blank for open-ended."><FriendlyDateInput value={values.activeTill} onChange={(v) => set('activeTill', v)} /></Field>
            <Field label="Lifecycle Status">
              <Select value={values.lifecycleStatus} onChange={(e) => set('lifecycleStatus', e.target.value as CommercialSku['lifecycleStatus'])}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="retired">Retired</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm text-ink-800">
              <input type="checkbox" checked={values.isSellable} onChange={(e) => set('isSellable', e.target.checked)} />
              Sellable
            </label>
          </div>
        </section>

        <SkuPricingLevelsSection
          sku={previewSku}
          values={values}
          onChangeSelectedLevels={(next) => set('selectedPricingLevels', next)}
          onChangeLevelField={(field, v) => set(field, v)}
        />

        {touchedSensitiveField && (
          <Field label="Reason for change" hint="Required for cost, pricing, or lifecycle status edits — recorded in the Audit Log." required>
            <Input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
          </Field>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      </div>
    </Dialog>
  )
}

/** The SKU-catalog counterpart to `SellingPriceSection` (the BOQ line-item
 *  version) — same interaction (persistent "Add Pricing Level" -> multi-
 *  select popover -> one independent collapsible card per added level) and
 *  the same pure pricing-logic helpers, just editing a SKU's own tier prices
 *  (`values[LEVEL_PRICE_FIELD[level]]`) instead of a line's override. Keeping
 *  both call sites on one shared model per spec: no separate SKU-only
 *  pricing-level UI. */
function SkuPricingLevelsSection({ sku, values, onChangeSelectedLevels, onChangeLevelField }: {
  sku: CommercialSku
  values: Values
  onChangeSelectedLevels: (next: SkuPricingLevelSetting[]) => void
  onChangeLevelField: (field: LevelPriceField, v: number) => void
}) {
  const selected = values.selectedPricingLevels
  const availableLevels = PRICING_LEVEL_KEYS.filter((k) => !selected.some((s) => s.level === k))
  const [pendingAdd, setPendingAdd] = useState<PricingLevelKey[]>([])

  function toggleQueued(level: PricingLevelKey) {
    setPendingAdd((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]))
  }

  function confirmAdd(close: () => void) {
    if (pendingAdd.length === 0) return
    const additions = pendingAdd.map((level) => ({ level, maximumDiscountPercent: values.maximumDiscountPercent }))
    onChangeSelectedLevels([...selected, ...additions])
    setPendingAdd([])
    close()
  }

  function removeLevel(level: PricingLevelKey) {
    onChangeSelectedLevels(selected.filter((s) => s.level !== level))
  }

  function setLevelMaxDiscount(level: PricingLevelKey, v: number) {
    onChangeSelectedLevels(selected.map((s) => (s.level === level ? { ...s, maximumDiscountPercent: v } : s)))
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

        {selected.length === 0 ? (
          <p className="text-[12px] text-muted">No pricing levels added yet — this SKU has no enabled tiers.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {selected.map((entry) => (
              <SkuPricingLevelCard
                key={entry.level}
                sku={sku}
                entry={entry}
                sellingPrice={values[LEVEL_PRICE_FIELD[entry.level]]}
                onSellingPriceChange={(v) => onChangeLevelField(LEVEL_PRICE_FIELD[entry.level], v)}
                onMaxDiscountChange={(v) => setLevelMaxDiscount(entry.level, v)}
                onRemove={() => removeLevel(entry.level)}
              />
            ))}
          </div>
        )}
      </div>
    </Collapsible>
  )
}

function SkuPricingLevelCard({ sku, entry, sellingPrice, onSellingPriceChange, onMaxDiscountChange, onRemove }: {
  sku: CommercialSku
  entry: SkuPricingLevelSetting
  sellingPrice: number
  onSellingPriceChange: (v: number) => void
  onMaxDiscountChange: (v: number) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState(sellingPrice === 0 ? '' : String(roundMoney(sellingPrice)))
  const currentMargin = marginPctForSellingPrice(sku, [], new Map(), sellingPrice)
  const [marginDraft, setMarginDraft] = useState(sellingPrice === 0 ? '' : currentMargin.toFixed(1))
  const discountPct = discountPctForSellingPrice(sku.listPrice, sellingPrice)
  const [discountDraft, setDiscountDraft] = useState(sellingPrice === 0 ? '' : discountPct.toFixed(1))
  const label = PRICING_LEVEL_LABEL[entry.level]

  function commitPrice() {
    const next = Number(priceDraft)
    setError(null)
    if (priceDraft.trim() === '' || !Number.isFinite(next)) return
    try {
      validateSellingPrice(sku, next, entry.level)
      onSellingPriceChange(next)
    } catch (e) {
      setError(e instanceof PricingValidationError ? e.message : 'Could not save this price.')
      setPriceDraft(sellingPrice === 0 ? '' : String(roundMoney(sellingPrice)))
    }
  }

  function commitDiscount() {
    const next = Number(discountDraft)
    setError(null)
    if (discountDraft.trim() === '' || !Number.isFinite(next)) return
    try {
      const candidatePrice = sellingPriceForDiscountPct(sku.listPrice, next)
      validateSellingPrice(sku, candidatePrice, entry.level)
      onSellingPriceChange(candidatePrice)
    } catch (e) {
      setError(e instanceof PricingValidationError ? e.message : 'Could not save this discount.')
      setDiscountDraft(sellingPrice === 0 ? '' : discountPct.toFixed(1))
    }
  }

  function commitMargin() {
    const next = Number(marginDraft)
    setError(null)
    if (marginDraft.trim() === '' || !Number.isFinite(next)) return
    try {
      const candidatePrice = sellingPriceForMargin(sku, [], new Map(), next, entry.level)
      onSellingPriceChange(candidatePrice)
    } catch (e) {
      setError(e instanceof PricingValidationError ? e.message : 'Could not save this margin.')
      setMarginDraft(sellingPrice === 0 ? '' : currentMargin.toFixed(1))
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel/30 p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-medium text-ink-800">
          <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} />
          {label}
        </button>
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
              placeholder={`e.g. ${sku.listPrice}`}
              aria-label={`${label} Selling Price`}
            />
          </Field>
          <Field label={`${label} Discount %`}>
            <Input
              type="number"
              value={discountDraft}
              onChange={(e) => setDiscountDraft(e.target.value)}
              onBlur={commitDiscount}
              placeholder="e.g. 20"
              aria-label={`${label} Discount %`}
            />
          </Field>
          <Field label={`${label} Maximum Discount %`}>
            <Input
              type="number"
              value={entry.maximumDiscountPercent === 0 ? '' : entry.maximumDiscountPercent}
              onChange={(e) => onMaxDiscountChange(e.target.value === '' ? 0 : Math.min(90, Number(e.target.value)))}
              placeholder="e.g. 90"
              aria-label={`${label} Maximum Discount %`}
            />
          </Field>
          <Field label={`${label} Margin %`}>
            <Input
              type="number"
              value={marginDraft}
              onChange={(e) => setMarginDraft(e.target.value)}
              onBlur={commitMargin}
              placeholder="e.g. 20"
              aria-label={`${label} Margin`}
            />
          </Field>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-rose-700">{error}</p>}
    </div>
  )
}

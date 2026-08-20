import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useMasters } from '../api'
import { computeSkuMarginPercent } from '../repository-logic'
import { PRICING_LEVEL_KEYS, PRICING_LEVEL_LABEL } from '../pricing-levels-logic'
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

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  )
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
  // like `id`/`skuCode`/`createdAt` from yet) — irrelevant to the margin
  // math itself, just enough to satisfy computeSkuMarginPercent's shape so
  // this preview isn't a second, hand-rolled copy of that formula.
  const previewMargin = computeSkuMarginPercent({
    ...(editing ?? { id: '', skuCode: '', createdAt: '', createdBy: null }),
    ...values,
    activeTill: values.activeTill || null,
  } as CommercialSku)

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
            <Field label="Name"><Input value={values.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="SKU Category">
              <Select value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </Select>
            </Field>
            <Field label="Feature" hint="Determines the generated SKU code.">
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
            <Field label="Unit of Measure">
              <Select value={values.uomId} onChange={(e) => set('uomId', e.target.value)}>
                <option value="">Select…</option>
                {uoms.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </Select>
            </Field>
            <Field label="Currency">
              <Select value={values.currencyId} onChange={(e) => set('currencyId', e.target.value)}>
                <option value="">Select…</option>
                {currencies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </Select>
            </Field>
            <Field label="Tax Class">
              <Select value={values.taxClassId} onChange={(e) => set('taxClassId', e.target.value)}>
                <option value="">Select…</option>
                {taxClasses.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
              </Select>
            </Field>
            <Field label="Billing Type">
              <Select value={values.billingTypeId} onChange={(e) => set('billingTypeId', e.target.value)}>
                <option value="">Select…</option>
                {billingTypes.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </Select>
            </Field>
            <Field label="Active From"><Input type="date" value={values.activeFrom} onChange={(e) => set('activeFrom', e.target.value)} /></Field>
            <Field label="Active Till" hint="Leave blank for open-ended."><Input type="date" value={values.activeTill} onChange={(e) => set('activeTill', e.target.value)} /></Field>
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

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Pricing</h3>
            <span className="text-[12px] font-medium text-ink-700">Margin at List Price: {previewMargin.toFixed(1)}%</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <NumberField label="List Price" value={values.listPrice} onChange={(v) => set('listPrice', v)} />
            <NumberField label="Minimum Allowed" value={values.minimumAllowedPrice} onChange={(v) => set('minimumAllowedPrice', v)} />
            <NumberField label="Default Max Discount %" value={values.maximumDiscountPercent} onChange={(v) => set('maximumDiscountPercent', Math.min(90, v))} />
          </div>
          <PricingLevelsSection
            values={values}
            onChangeSelectedLevels={(next) => set('selectedPricingLevels', next)}
            onChangeLevelField={(field, v) => set(field, v)}
          />
        </section>

        {touchedSensitiveField && (
          <Field label="Reason for change" hint="Required for cost, pricing, or lifecycle status edits — recorded in the Audit Log.">
            <Input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
          </Field>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      </div>
    </Dialog>
  )
}

function PricingLevelsSection({ values, onChangeSelectedLevels, onChangeLevelField }: {
  values: Values
  onChangeSelectedLevels: (next: SkuPricingLevelSetting[]) => void
  onChangeLevelField: (field: LevelPriceField, v: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<Set<PricingLevelKey>>(new Set())
  const selected = values.selectedPricingLevels
  const availableLevels = PRICING_LEVEL_KEYS.filter((k) => !selected.some((s) => s.level === k))

  function toggleChecked(level: PricingLevelKey) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  function addSelected() {
    const additions = availableLevels
      .filter((k) => checked.has(k))
      .map((level) => ({ level, maximumDiscountPercent: values.maximumDiscountPercent }))
    if (additions.length === 0) return
    onChangeSelectedLevels([...selected, ...additions])
    setChecked(new Set())
  }

  function removeLevel(level: PricingLevelKey) {
    onChangeSelectedLevels(selected.filter((s) => s.level !== level))
  }

  function setLevelMaxDiscount(level: PricingLevelKey, v: number) {
    onChangeSelectedLevels(selected.map((s) => (s.level === level ? { ...s, maximumDiscountPercent: v } : s)))
  }

  return (
    <div className="rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-muted"
      >
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} />
        Set Pricing Levels
        {selected.length > 0 && <span className="normal-case text-ink-600">({selected.length} selected)</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line p-3">
          {availableLevels.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-ink-700">Select pricing levels:</span>
              <div className="flex flex-wrap gap-3">
                {availableLevels.map((level) => (
                  <label key={level} className="flex items-center gap-1.5 text-[13px] text-ink-800">
                    <input type="checkbox" checked={checked.has(level)} onChange={() => toggleChecked(level)} />
                    {PRICING_LEVEL_LABEL[level]}
                  </label>
                ))}
              </div>
              <Button size="sm" onClick={addSelected} disabled={checked.size === 0} className="self-start">
                <Icon name="Plus" size={13} />
                Add Selected
              </Button>
            </div>
          )}

          {selected.length === 0 ? (
            <p className="text-[12px] text-muted">No pricing levels selected yet — this SKU has no enabled tiers.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {selected.map((entry) => (
                <PricingLevelCard
                  key={entry.level}
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
      )}
    </div>
  )
}

function PricingLevelCard({ entry, sellingPrice, onSellingPriceChange, onMaxDiscountChange, onRemove }: {
  entry: SkuPricingLevelSetting
  sellingPrice: number
  onSellingPriceChange: (v: number) => void
  onMaxDiscountChange: (v: number) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)
  const label = PRICING_LEVEL_LABEL[entry.level]
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
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label={`${label} Selling Price`}>
            <Input
              type="number"
              value={sellingPrice}
              onChange={(e) => onSellingPriceChange(Number(e.target.value))}
              aria-label={`${label} Selling Price`}
            />
          </Field>
          <Field label={`${label} Maximum Discount %`}>
            <Input
              type="number"
              value={entry.maximumDiscountPercent}
              onChange={(e) => onMaxDiscountChange(Math.min(90, Number(e.target.value)))}
              aria-label={`${label} Maximum Discount %`}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { useBomItems, useBomMutations, useSkus } from '../api'

/** Per-SKU Commercial BOM editor — pick a parent SKU, then add/remove
 *  mandatory or optional component SKUs (spec §6.4/PCS-032/033). */
export function CommercialBom() {
  const { data: skus = [] } = useSkus()
  const [parentSkuId, setParentSkuId] = useState('')
  const { data: items = [] } = useBomItems(parentSkuId || null)
  const { add, remove } = useBomMutations(parentSkuId)

  const [componentSkuId, setComponentSkuId] = useState('')
  const [mandatory, setMandatory] = useState(true)
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const skuById = new Map(skus.map((s) => [s.id, s]))
  const componentOptions = skus.filter((s) => s.id !== parentSkuId)

  async function handleAdd() {
    if (!parentSkuId || !componentSkuId) return
    setError(null)
    try {
      await add.mutateAsync({ parentSkuId, componentSkuId, mandatory, quantity, notes })
      setComponentSkuId('')
      setQuantity(1)
      setNotes('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add component.')
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <Field label="Parent SKU">
        <Select value={parentSkuId} onChange={(e) => setParentSkuId(e.target.value)}>
          <option value="">Select a SKU to configure its BOM…</option>
          {skus.map((s) => <option key={s.id} value={s.id}>{s.skuCode} — {s.name}</option>)}
        </Select>
      </Field>

      {parentSkuId && (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-3">
            <Field label="Component SKU">
              <Select value={componentSkuId} onChange={(e) => setComponentSkuId(e.target.value)}>
                <option value="">Select…</option>
                {componentOptions.map((s) => <option key={s.id} value={s.id}>{s.skuCode} — {s.name}</option>)}
              </Select>
            </Field>
            <Field label="Quantity">
              <Input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="w-24" />
            </Field>
            <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-800">
              <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
              Mandatory
            </label>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-56" />
            </Field>
            <Button variant="primary" size="sm" onClick={handleAdd} disabled={!componentSkuId}>
              <Icon name="Plus" size={14} />
              Add
            </Button>
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

          <div className="flex flex-col gap-4">
            <div>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Mandatory Components</h3>
              {items.filter((i) => i.mandatory).length === 0 ? (
                <p className="text-[13px] text-muted">None yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {items.filter((i) => i.mandatory).map((item) => (
                    <BomRow key={item.id} label={skuLabel(skuById.get(item.componentSkuId))} quantity={item.quantity} notes={item.notes} onRemove={() => remove.mutate(item.id)} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Optional Components</h3>
              {items.filter((i) => !i.mandatory).length === 0 ? (
                <p className="text-[13px] text-muted">None yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {items.filter((i) => !i.mandatory).map((item) => (
                    <BomRow key={item.id} label={skuLabel(skuById.get(item.componentSkuId))} quantity={item.quantity} notes={item.notes} onRemove={() => remove.mutate(item.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function skuLabel(sku: { skuCode: string; name: string } | undefined): string {
  return sku ? `${sku.skuCode} — ${sku.name}` : 'Unknown SKU'
}

function BomRow({ label, quantity, notes, onRemove }: { label: string; quantity: number; notes: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink-900">{label}</div>
        {notes && <div className="truncate text-[12px] text-muted">{notes}</div>}
      </div>
      <span className="shrink-0 text-[12px] text-muted">Qty {quantity}</span>
      <Button size="icon" onClick={onRemove} title="Remove"><Icon name="Trash2" size={15} /></Button>
    </div>
  )
}

import { Input, Select } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { uid } from '@/lib/utils'
import { WORK_COMPONENTS, WORK_VERTICALS, withValue } from './department-meta'
import type { DepartmentWork } from '@/lib/types'

const COLS = 'grid grid-cols-[minmax(0,1fr)_9rem_4.5rem_7rem_10rem_2rem] gap-2'

/** Editable multi-row table of a department's works. Add / edit inline / remove. */
export function WorksEditor({ works, onChange }: {
  works: DepartmentWork[]
  onChange: (works: DepartmentWork[]) => void
}) {
  const update = (id: string, patch: Partial<DepartmentWork>) =>
    onChange(works.map((w) => (w.id === id ? { ...w, ...patch } : w)))
  const remove = (id: string) => onChange(works.filter((w) => w.id !== id))
  const add = () =>
    onChange([
      ...works,
      { id: uid('work'), name: '', component: WORK_COMPONENTS[0], quantity: '', value: '', vertical: WORK_VERTICALS[0] },
    ])

  return (
    <div className="space-y-2">
      {works.length === 0 ? (
        <p className="text-sm text-muted">No works added yet.</p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[640px] space-y-2">
            <div className={`${COLS} px-1 text-[11px] uppercase tracking-wide text-muted`}>
              <span>Work name</span><span>Component</span><span>Qty</span><span>Value</span><span>Vertical / OEM</span><span />
            </div>
            {works.map((w) => (
              <div key={w.id} className={`${COLS} items-center`}>
                <Input value={w.name} onChange={(e) => update(w.id, { name: e.target.value })} placeholder="e.g. ATCS rollout" />
                <Select value={w.component} onChange={(e) => update(w.id, { component: e.target.value })}>
                  {withValue(WORK_COMPONENTS, w.component).map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <Input value={w.quantity} onChange={(e) => update(w.id, { quantity: e.target.value })} inputMode="numeric" placeholder="0" />
                <Input value={w.value} onChange={(e) => update(w.id, { value: e.target.value })} placeholder="₹ / amount" />
                <Select value={w.vertical} onChange={(e) => update(w.id, { vertical: e.target.value })}>
                  {withValue(WORK_VERTICALS, w.vertical).map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
                <button
                  type="button"
                  onClick={() => remove(w.id)}
                  aria-label="Remove work row"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-crimson-100 hover:text-crimson"
                >
                  <Icon name="Trash2" size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <Button size="sm" onClick={add}><Icon name="Plus" size={14} /> Add row</Button>
    </div>
  )
}

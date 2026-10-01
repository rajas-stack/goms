import { useEffect, useMemo, useState } from 'react'
import type { TypedFilterRule } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input } from '@/components/ui/Field'
import { useBidCustomFields, useBidSavedViewMutations } from '@/lib/api'
import type { BidSavedView } from '@/lib/types'
import { cn } from '@/lib/utils'
import { isRuleComplete, resolveColumns } from '../gridColumns'
import { FilterBuilder } from './FilterBuilder'

const SCOPES: { value: 'personal' | 'global'; title: string; hint: string }[] = [
  { value: 'personal', title: 'Personal', hint: 'Bound to your account, visible only to you.' },
  { value: 'global', title: 'Global', hint: 'Available for all team members.' },
]

/** Saves the grid's current setup as a view: its filters (editable here, in the
 *  same WHERE/operator/value builder as the grid), and its ordered column list. */
export function CreateSavedViewDialog({ open, onClose, initialFilterRules, visibleColumns, onCreated }: {
  open: boolean
  onClose: () => void
  initialFilterRules: TypedFilterRule[]
  /** Ordered visible column ids; empty/undefined = default (all). */
  visibleColumns?: string[]
  onCreated?: (view: BidSavedView) => void
}) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'personal' | 'global'>('personal')
  const [rules, setRules] = useState<TypedFilterRule[]>(initialFilterRules)
  const [error, setError] = useState<string | null>(null)
  const { create } = useBidSavedViewMutations()
  const { data: customFields = [] } = useBidCustomFields()
  const filterable = useMemo(() => resolveColumns(customFields).filter((c) => c.type !== null), [customFields])

  // Each time the dialog opens it starts from whatever the grid is showing now.
  useEffect(() => {
    if (open) { setName(''); setScope('personal'); setRules(initialFilterRules); setError(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    setError(null)
    try {
      const view = await create.mutateAsync({
        name: name.trim(), scope, filterRules: rules.filter(isRuleComplete), visibleColumns: visibleColumns ?? [],
      })
      onCreated?.(view)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the view.')
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title="Create Saved View" size="lg"
      description="Save your current filter configuration for quick access"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={submit}>Create View</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="View Name" required>
          <Input
            value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="e.g. Due Next 7 Days, High Value Smart Cities"
          />
        </Field>
        <div role="radiogroup" aria-label="Visibility" className="grid gap-2 sm:grid-cols-2">
          {SCOPES.map((s) => (
            <button
              key={s.value} type="button" role="radio" aria-checked={scope === s.value} onClick={() => setScope(s.value)}
              className={cn(
                'rounded-lg border p-3 text-left focus-visible:focus-ring',
                scope === s.value ? 'border-ink-900 bg-ink-900/[0.04]' : 'border-line hover:border-ink-600',
              )}
            >
              <div className="text-sm font-semibold text-ink">{s.title}</div>
              <div className="text-[12px] text-muted">{s.hint}</div>
            </button>
          ))}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Filters</div>
          <div className="rounded-lg border border-line"><FilterBuilder columns={filterable} rules={rules} onChange={setRules} /></div>
        </div>
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
      </div>
    </Dialog>
  )
}

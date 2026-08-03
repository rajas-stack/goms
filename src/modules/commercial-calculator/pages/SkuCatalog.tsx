import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { useToast } from '@/components/ui/Toast'
import { useMasters, useSkuMutations, useSkus } from '../api'
import { SkuFormDialog } from '../components/SkuFormDialog'
import { computeSkuMarginPercent } from '../repository-logic'
import type { CommercialSku, CreateSkuInput } from '../types'

const LIFECYCLE_STYLE: Record<CommercialSku['lifecycleStatus'], string> = {
  draft: 'bg-ink-900/[0.06] text-ink-600',
  active: 'bg-emerald-50 text-emerald-700',
  inactive: 'bg-amber-50 text-amber-700',
  retired: 'bg-rose-50 text-rose-700',
}

export function SkuCatalog() {
  const { data: skus = [] } = useSkus()
  const { data: categories = [] } = useMasters('skuCategories')
  const { create, update, remove } = useSkuMutations()
  const toast = useToast()

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CommercialSku | null>(null)
  const [deleting, setDeleting] = useState<CommercialSku | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skus
    return skus.filter((s) => s.skuCode.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
  }, [skus, query])

  async function handleSubmit(input: CreateSkuInput | Partial<CommercialSku>, changeReason?: string) {
    if (editing) {
      await update.mutateAsync({ id: editing.id, patch: input as Partial<CommercialSku>, changeReason })
      toast('SKU updated.')
    } else {
      await create.mutateAsync(input as CreateSkuInput)
      toast('SKU created.')
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search SKU code or name…" className="pl-9" />
        </div>
        <Button variant="primary" size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>
          <Icon name="Plus" size={15} />
          Add SKU
        </Button>
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <Icon name="Boxes" size={20} className="text-muted" />
          <p className="text-sm text-muted">No SKUs yet — add one, or add Features first under Masters → Hierarchy.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((sku) => (
          <div key={sku.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{sku.skuCode}</span>
                <span className="truncate text-sm font-medium text-ink-900">{sku.name}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${LIFECYCLE_STYLE[sku.lifecycleStatus]}`}>
                  {sku.lifecycleStatus}
                </span>
              </div>
              <div className="text-[12px] text-muted">
                {categoryName.get(sku.categoryId) ?? '—'} · List {sku.listPrice.toLocaleString()} · Margin {computeSkuMarginPercent(sku).toFixed(1)}%
              </div>
            </div>
            <Button size="icon" onClick={() => { setEditing(sku); setFormOpen(true) }} title="Edit">
              <Icon name="Pencil" size={15} />
            </Button>
            <Button size="icon" onClick={() => setDeleting(sku)} title="Delete">
              <Icon name="Trash2" size={15} />
            </Button>
          </div>
        ))}
      </div>

      <SkuFormDialog open={formOpen} onClose={() => setFormOpen(false)} editing={editing} onSubmit={handleSubmit} />
      {deleting && (
        <ConfirmDeleteDialog
          open={!!deleting}
          onClose={() => setDeleting(null)}
          itemLabel={`${deleting.skuCode} — ${deleting.name}`}
          onConfirm={() => remove.mutateAsync(deleting.id)}
        />
      )}
    </div>
  )
}

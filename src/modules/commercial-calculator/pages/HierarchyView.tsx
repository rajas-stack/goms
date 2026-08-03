import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { useToast } from '@/components/ui/Toast'
import { useMasterMutations, useMasters, useSkus } from '../api'
import { MASTER_DEFS } from '../master-defs'
import { MasterFormDialog } from '../components/MasterFormDialog'
import { cn } from '@/lib/utils'
import type { MasterBase, MasterEntityKey } from '../types'

type HierarchyKey = 'verticals' | 'products' | 'modules' | 'features'
type MasterRow = MasterBase & Record<string, unknown>
interface Selection { type: HierarchyKey; id: string }

/** Vertical → Product → Module → Feature as a connected tree with a details
 *  panel, replacing 4 unrelated CRUD tabs — the relationship between levels
 *  is always visible, and picking a node shows everything under it without
 *  changing screens. */
export function HierarchyView() {
  const { data: verticalsRaw = [] } = useMasters('verticals')
  const { data: productsRaw = [] } = useMasters('products')
  const { data: modulesRaw = [] } = useMasters('modules')
  const { data: featuresRaw = [] } = useMasters('features')
  // Cast once, here — concrete master row interfaces (Vertical, CommercialProduct, …)
  // don't structurally satisfy MasterRow's `Record<string, unknown>` half (no
  // index signature), same as the generic engine's repository-logic.ts casts.
  const verticals = verticalsRaw as unknown as MasterRow[]
  const products = productsRaw as unknown as MasterRow[]
  const modules = modulesRaw as unknown as MasterRow[]
  const features = featuresRaw as unknown as MasterRow[]
  const { data: skus = [] } = useSkus()
  const toast = useToast()

  const verticalMutations = useMasterMutations('verticals')
  const productMutations = useMasterMutations('products')
  const moduleMutations = useMasterMutations('modules')
  const featureMutations = useMasterMutations('features')
  const mutationsByKey = {
    verticals: verticalMutations, products: productMutations, modules: moduleMutations, features: featureMutations,
  } as const

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [formState, setFormState] = useState<{ masterKey: HierarchyKey; editing: MasterRow | null; parentId?: string } | null>(null)
  const [deleting, setDeleting] = useState<{ masterKey: HierarchyKey; row: MasterRow } | null>(null)

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(values: Record<string, string | number | boolean>, changeReason?: string) {
    if (!formState) return
    const { masterKey, editing } = formState
    const mutations = mutationsByKey[masterKey]
    if (editing) {
      await mutations.update.mutateAsync({ id: editing.id, patch: values as never, changeReason })
      toast(`${MASTER_DEFS[masterKey].singularLabel} updated.`)
    } else {
      await mutations.create.mutateAsync(values as never)
      toast(`${MASTER_DEFS[masterKey].singularLabel} created.`)
    }
  }

  const productsByVertical = useMemo(() => {
    const map = new Map<string, MasterRow[]>()
    for (const p of products) {
      const key = p.verticalId as string
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return map
  }, [products])
  const modulesByProduct = useMemo(() => {
    const map = new Map<string, MasterRow[]>()
    for (const m of modules) {
      const key = m.productId as string
      map.set(key, [...(map.get(key) ?? []), m])
    }
    return map
  }, [modules])
  const featuresByModule = useMemo(() => {
    const map = new Map<string, MasterRow[]>()
    for (const f of features) {
      const key = f.moduleId as string
      map.set(key, [...(map.get(key) ?? []), f])
    }
    return map
  }, [features])
  const skusByFeature = useMemo(() => {
    const map = new Map<string, typeof skus>()
    for (const s of skus) map.set(s.featureId, [...(map.get(s.featureId) ?? []), s])
    return map
  }, [skus])

  function Row({ masterKey, row, depth, childCount }: { masterKey: HierarchyKey; row: MasterRow; depth: number; childCount: number }) {
    const isExpanded = expanded.has(row.id)
    const isSelected = selection?.type === masterKey && selection.id === row.id
    return (
      <div
        onClick={() => setSelection({ type: masterKey, id: row.id })}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left transition-colors',
          isSelected ? 'bg-ink-900/[0.06]' : 'hover:bg-ink-900/[0.03]',
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {childCount > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(row.id) }}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-muted"
          >
            <Icon name={isExpanded ? 'ChevronDown' : 'ChevronRight'} size={14} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[10px] font-mono text-ink-700">{row.code}</span>
        <span className="truncate text-[13px] font-medium text-ink-900">{row.name}</span>
        {!row.active && <span className="shrink-0 text-[11px] text-muted">Inactive</span>}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-r border-line p-2">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Vertical → Product → Module → Feature</span>
          <Button size="icon" title="Add Vertical" onClick={() => setFormState({ masterKey: 'verticals', editing: null })}>
            <Icon name="Plus" size={14} />
          </Button>
        </div>
        {verticals.length === 0 && <p className="px-3 py-4 text-[13px] text-muted">No verticals yet — add one to start the hierarchy.</p>}
        {verticals.map((v) => (
          <div key={v.id}>
            <Row masterKey="verticals" row={v} depth={0} childCount={(productsByVertical.get(v.id) ?? []).length} />
            {expanded.has(v.id) && (productsByVertical.get(v.id) ?? []).map((p) => (
              <div key={p.id}>
                <Row masterKey="products" row={p} depth={1} childCount={(modulesByProduct.get(p.id) ?? []).length} />
                {expanded.has(p.id) && (modulesByProduct.get(p.id) ?? []).map((m) => (
                  <div key={m.id}>
                    <Row masterKey="modules" row={m} depth={2} childCount={(featuresByModule.get(m.id) ?? []).length} />
                    {expanded.has(m.id) && (featuresByModule.get(m.id) ?? []).map((f) => (
                      <Row key={f.id} masterKey="features" row={f} depth={3} childCount={0} />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!selection ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Icon name="GitBranch" size={20} className="text-muted" />
            <p className="text-sm text-muted">Select a Vertical, Product, Module, or Feature to see its details.</p>
          </div>
        ) : (
          <DetailsPane
            selection={selection}
            verticals={verticals} products={products} modules={modules} features={features}
            productsByVertical={productsByVertical} modulesByProduct={modulesByProduct} featuresByModule={featuresByModule}
            skusByFeature={skusByFeature}
            onEdit={(masterKey, row) => setFormState({ masterKey, editing: row })}
            onDelete={(masterKey, row) => setDeleting({ masterKey, row })}
            onAddChild={(masterKey, parentId) => setFormState({ masterKey, editing: null, parentId })}
            onSelect={setSelection}
          />
        )}
      </div>

      {formState && (
        <MasterFormDialog
          masterKey={formState.masterKey}
          def={MASTER_DEFS[formState.masterKey]}
          open={!!formState}
          onClose={() => setFormState(null)}
          editing={
            formState.editing ??
            (formState.parentId
              ? ({ id: '', code: '', name: '', description: '', active: true, displayOrder: 0, [parentFieldKey(formState.masterKey)]: formState.parentId } as unknown as MasterRow)
              : null)
          }
          onSubmit={handleSubmit}
        />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          open={!!deleting}
          onClose={() => setDeleting(null)}
          itemLabel={deleting.row.name}
          onConfirm={async () => {
            await mutationsByKey[deleting.masterKey].remove.mutateAsync(deleting.row.id)
            setSelection(null)
          }}
        />
      )}
    </div>
  )
}

function parentFieldKey(masterKey: HierarchyKey): string {
  return masterKey === 'products' ? 'verticalId' : masterKey === 'modules' ? 'productId' : masterKey === 'features' ? 'moduleId' : ''
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm text-ink-900">{value || '—'}</div>
    </div>
  )
}

function ChildList({ title, items, onAdd }: {
  title: string
  items: { id: string; code: string; name: string; onClick: () => void }[]
  onAdd: () => void
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{title} ({items.length})</span>
        <Button size="sm" onClick={onAdd}><Icon name="Plus" size={13} />Add</Button>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">None yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {items.map((it) => (
            <button key={it.id} onClick={it.onClick} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink-900/[0.04]">
              <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] font-mono text-ink-700">{it.code}</span>
              <span className="truncate text-[13px] text-ink-900">{it.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DetailsPane({
  selection, verticals, products, modules, features, productsByVertical, modulesByProduct, featuresByModule,
  skusByFeature, onEdit, onDelete, onAddChild, onSelect,
}: {
  selection: Selection
  verticals: MasterRow[]; products: MasterRow[]; modules: MasterRow[]; features: MasterRow[]
  productsByVertical: Map<string, MasterRow[]>; modulesByProduct: Map<string, MasterRow[]>; featuresByModule: Map<string, MasterRow[]>
  skusByFeature: Map<string, { id: string; skuCode: string; name: string }[]>
  onEdit: (masterKey: HierarchyKey, row: MasterRow) => void
  onDelete: (masterKey: HierarchyKey, row: MasterRow) => void
  onAddChild: (masterKey: HierarchyKey, parentId: string) => void
  onSelect: (s: Selection) => void
}) {
  const rowsByKey: Record<HierarchyKey, MasterRow[]> = { verticals, products, modules, features }
  const row = rowsByKey[selection.type].find((r) => r.id === selection.id)
  if (!row) return null

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{MASTER_DEFS[selection.type].singularLabel}</div>
          <h2 className="text-lg font-semibold text-ink-900">{row.name}</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onEdit(selection.type, row)}><Icon name="Pencil" size={13} />Edit</Button>
          <Button size="sm" onClick={() => onDelete(selection.type, row)}><Icon name="Trash2" size={13} />Delete</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-xl border border-line p-3">
        <DetailField label="Code" value={String(row.code)} />
        <DetailField label="Status" value={row.active ? 'Active' : 'Inactive'} />
        <DetailField label="Description" value={String(row.description ?? '')} />
        {selection.type === 'features' && <DetailField label="Feature Status" value={String(row.status ?? '')} />}
      </div>

      {selection.type === 'verticals' && (
        <ChildList
          title="Products"
          items={(productsByVertical.get(row.id) ?? []).map((p) => ({
            id: p.id, code: String(p.code), name: String(p.name), onClick: () => onSelect({ type: 'products', id: p.id }),
          }))}
          onAdd={() => onAddChild('products', row.id)}
        />
      )}
      {selection.type === 'products' && (
        <ChildList
          title="Modules"
          items={(modulesByProduct.get(row.id) ?? []).map((m) => ({
            id: m.id, code: String(m.code), name: String(m.name), onClick: () => onSelect({ type: 'modules', id: m.id }),
          }))}
          onAdd={() => onAddChild('modules', row.id)}
        />
      )}
      {selection.type === 'modules' && (
        <ChildList
          title="Features"
          items={(featuresByModule.get(row.id) ?? []).map((f) => ({
            id: f.id, code: String(f.code), name: String(f.name), onClick: () => onSelect({ type: 'features', id: f.id }),
          }))}
          onAdd={() => onAddChild('features', row.id)}
        />
      )}
      {selection.type === 'features' && (
        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
            SKUs using this feature ({(skusByFeature.get(row.id) ?? []).length})
          </div>
          {(skusByFeature.get(row.id) ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">No SKUs created for this feature yet — see SKU Catalog.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {(skusByFeature.get(row.id) ?? []).map((s) => (
                <div key={s.id} className="flex items-center gap-2 px-2 py-1">
                  <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] font-mono text-ink-700">{s.skuCode}</span>
                  <span className="truncate text-[13px] text-ink-900">{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { useAllBomItems, useAllBoqLineItems, useAuditLogs, useMasters, useSkuMutations, useSkus } from '../api'
import { SkuFormDialog } from '../components/SkuFormDialog'
import { SkuBomEditor } from '../components/SkuBomEditor'
import { computeSkuMarginPercent } from '../repository-logic'
import { marginPctForSellingPrice, PRICING_LEVEL_LABEL } from '../pricing-levels-logic'
import { formatPercent } from '../format'
import type { CommercialBomItem, CommercialSku, CreateSkuInput, PricingLevelKey } from '../types'

const LIFECYCLE_STYLE: Record<CommercialSku['lifecycleStatus'], string> = {
  draft: 'bg-ink-900/[0.06] text-ink-600',
  active: 'bg-emerald-50 text-emerald-700',
  inactive: 'bg-amber-50 text-amber-700',
  retired: 'bg-rose-50 text-rose-700',
}

type Tab = 'overview' | 'pricing' | 'bom' | 'audit'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'bom', label: 'BOM' },
  { key: 'audit', label: 'Audit History' },
]

/** SKU Catalog, redesigned 2026-08-03 from a flat searchable card list into a
 *  product-detail experience (list + master-detail, matching HierarchyView's
 *  pattern): a compact filterable list on the left, a full product page with
 *  Overview/Pricing/BOM/Audit tabs on the right. Commercial BOM has no
 *  standalone module tab anymore — it's the BOM tab here, scoped to whichever
 *  SKU is selected. */
export function SkuCatalog() {
  const { data: skus = [] } = useSkus()
  const { data: categories = [] } = useMasters('skuCategories')
  const { data: allBomItems = [] } = useAllBomItems()
  const { data: allBoqLineItems = [] } = useAllBoqLineItems()
  const { create, update, remove } = useSkuMutations()
  const toast = useToast()

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const skusById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus])
  const usageCountBySku = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of allBomItems) map.set(b.componentSkuId, (map.get(b.componentSkuId) ?? 0) + 1)
    return map
  }, [allBomItems])
  const boqCountBySku = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const li of allBoqLineItems) {
      if (!map.has(li.skuId)) map.set(li.skuId, new Set())
      map.get(li.skuId)!.add(li.boqId)
    }
    return map
  }, [allBoqLineItems])

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CommercialSku | null>(null)
  const [deleting, setDeleting] = useState<CommercialSku | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skus.filter((s) => {
      const matchesQuery = !q || s.skuCode.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      const matchesStatus = !statusFilter || s.lifecycleStatus === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [skus, query, statusFilter])

  const selected = skus.find((s) => s.id === selectedId) ?? null

  async function handleSubmit(input: CreateSkuInput | Partial<CommercialSku>, changeReason?: string) {
    if (editing) {
      await update.mutateAsync({ id: editing.id, patch: input as Partial<CommercialSku>, changeReason })
      toast('SKU updated.')
    } else {
      const created = await create.mutateAsync(input as CreateSkuInput)
      toast('SKU created.')
      setSelectedId(created.id)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex max-h-64 w-full shrink-0 flex-col gap-2 overflow-y-auto border-b border-line p-3 lg:h-auto lg:max-h-none lg:w-[380px] lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU code or name…" className="pl-9" />
          </div>
          <Button variant="primary" size="sm" onClick={() => { setEditing(null); setFormOpen(true) }} title="Add SKU">
            <Icon name="Plus" size={15} />
          </Button>
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="retired">Retired</option>
        </Select>

        {filtered.length === 0 && (
          <p className="px-1 py-6 text-center text-[13px] text-muted">
            No SKUs match. {skus.length === 0 && 'Add one, or add Features first under Catalog → Hierarchy.'}
          </p>
        )}
        {filtered.map((sku) => (
          <button
            key={sku.id}
            onClick={() => { setSelectedId(sku.id); setTab('overview') }}
            className={`flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 text-left ${
              sku.id === selectedId ? 'border-ink-900/20 bg-ink-900/[0.04]' : 'border-line bg-white hover:bg-panel'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[12px] font-medium text-ink-900">{sku.skuCode}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${LIFECYCLE_STYLE[sku.lifecycleStatus]}`}>
                {sku.lifecycleStatus}
              </span>
            </div>
            <div className="truncate text-[13px] text-ink-800">{sku.name}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
              <span>{categoryName.get(sku.categoryId) ?? '—'}</span>
              <span>List {sku.listPrice.toLocaleString()}</span>
              <span>Margin {formatPercent(computeSkuMarginPercent(sku, allBomItems, skusById))}</span>
              <span>{usageCountBySku.get(sku.id) ?? 0} BOM refs</span>
              <span>{boqCountBySku.get(sku.id)?.size ?? 0} BOQs</span>
            </div>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Icon name="Boxes" size={20} className="text-muted" />
            <p className="text-sm text-muted">Select a SKU to see its details.</p>
          </div>
        ) : (
          <SkuDetail
            sku={selected}
            tab={tab}
            onTabChange={setTab}
            usageCount={usageCountBySku.get(selected.id) ?? 0}
            boqCount={boqCountBySku.get(selected.id)?.size ?? 0}
            categoryName={categoryName.get(selected.categoryId) ?? '—'}
            bomItems={allBomItems}
            skusById={skusById}
            onEdit={() => { setEditing(selected); setFormOpen(true) }}
            onDelete={() => setDeleting(selected)}
          />
        )}
      </div>

      <SkuFormDialog open={formOpen} onClose={() => setFormOpen(false)} editing={editing} onSubmit={handleSubmit} />
      {deleting && (
        <ConfirmDeleteDialog
          open={!!deleting}
          onClose={() => setDeleting(null)}
          itemLabel={`${deleting.skuCode} — ${deleting.name}`}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id)
            if (selectedId === deleting.id) setSelectedId(null)
          }}
        />
      )}
    </div>
  )
}

function SkuDetail({ sku, tab, onTabChange, usageCount, boqCount, categoryName, bomItems, skusById, onEdit, onDelete }: {
  sku: CommercialSku
  tab: Tab
  onTabChange: (t: Tab) => void
  usageCount: number
  boqCount: number
  categoryName: string
  bomItems: CommercialBomItem[]
  skusById: Map<string, CommercialSku>
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">SKU</div>
          <h2 className="font-mono text-lg font-semibold text-ink-900">{sku.skuCode}</h2>
          <p className="text-[13px] text-muted">{sku.name}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onEdit}><Icon name="Pencil" size={13} />Edit</Button>
          <Menu
            align="end"
            trigger={({ open, toggle }) => (
              <Button
                size="icon"
                variant="ghost"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                className={cn(open && 'bg-ink-900/[0.05] text-ink')}
              >
                <Icon name="MoreHorizontal" size={16} />
              </Button>
            )}
          >
            {(close) => (
              <MenuItem icon={<Icon name="Trash2" size={15} />} danger onClick={() => { close(); onDelete() }}>
                Delete
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-line p-3 text-sm sm:grid-cols-5">
        <DetailField label="Status" value={sku.lifecycleStatus} />
        <DetailField label="List Price" value={sku.listPrice.toLocaleString()} />
        <DetailField label="Margin" value={formatPercent(computeSkuMarginPercent(sku, bomItems, skusById))} />
        <DetailField label="Used in BOMs" value={String(usageCount)} />
        <DetailField label="Used in BOQs" value={String(boqCount)} />
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`shrink-0 rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors ${
              t.key === tab ? 'border-b-2 border-ink-900 text-ink-900' : 'text-ink-600/70 hover:text-ink-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-1">
        {tab === 'overview' && <OverviewTab sku={sku} categoryName={categoryName} />}
        {tab === 'pricing' && <PricingTab sku={sku} bomItems={bomItems} skusById={skusById} />}
        {tab === 'bom' && <SkuBomEditor skuId={sku.id} />}
        {tab === 'audit' && <AuditTab skuId={sku.id} />}
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm text-ink-900">{value || '—'}</div>
    </div>
  )
}

function OverviewTab({ sku, categoryName }: { sku: CommercialSku; categoryName: string }) {
  const { data: features = [] } = useMasters('features')
  const { data: editions = [] } = useMasters('productEditions')
  const { data: uoms = [] } = useMasters('unitsOfMeasure')
  const { data: currencies = [] } = useMasters('currencies')
  const { data: taxClasses = [] } = useMasters('taxClasses')
  const { data: billingTypes = [] } = useMasters('billingTypes')

  return (
    <div className="grid grid-cols-2 gap-4 rounded-xl border border-line p-4 sm:grid-cols-3">
      <DetailField label="Category" value={categoryName} />
      <DetailField label="Feature" value={features.find((f) => f.id === sku.featureId)?.name ?? '—'} />
      <DetailField label="Product Edition" value={editions.find((e) => e.id === sku.editionId)?.name ?? '—'} />
      <DetailField label="Unit of Measure" value={uoms.find((u) => u.id === sku.uomId)?.name ?? '—'} />
      <DetailField label="Currency" value={currencies.find((c) => c.id === sku.currencyId)?.code ?? '—'} />
      <DetailField label="Tax Class" value={taxClasses.find((t) => t.id === sku.taxClassId)?.name ?? '—'} />
      <DetailField label="Billing Type" value={billingTypes.find((b) => b.id === sku.billingTypeId)?.name ?? '—'} />
      <DetailField label="Active From" value={sku.activeFrom} />
      <DetailField label="Active Till" value={sku.activeTill ?? 'Open-ended'} />
      <DetailField label="Sellable" value={sku.isSellable ? 'Yes' : 'No'} />
    </div>
  )
}

const LEVEL_PRICE: Record<PricingLevelKey, keyof CommercialSku> = {
  internal: 'internalPrice', floor: 'floorPrice', partner: 'partnerPrice',
  government: 'governmentPrice', enterprise: 'enterprisePrice', corporate: 'corporatePrice',
}

function PricingTab({ sku, bomItems, skusById }: { sku: CommercialSku; bomItems: CommercialBomItem[]; skusById: Map<string, CommercialSku> }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Pricing Levels</div>
      {sku.selectedPricingLevels.length === 0 ? (
        <p className="text-[13px] text-muted">No pricing levels configured for this SKU yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {sku.selectedPricingLevels.map((entry) => {
            const sellingPrice = sku[LEVEL_PRICE[entry.level]] as number
            const margin = marginPctForSellingPrice(sku, bomItems, skusById, sellingPrice)
            return (
              <div key={entry.level} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <div className="text-[12px] font-semibold text-ink-900">{PRICING_LEVEL_LABEL[entry.level]}</div>
                <DetailField label="Selling Price" value={sellingPrice.toLocaleString()} />
                <DetailField label="Maximum Discount %" value={`${entry.maximumDiscountPercent}%`} />
                <DetailField label="Margin" value={formatPercent(margin)} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AuditTab({ skuId }: { skuId: string }) {
  const { data: rows = [] } = useAuditLogs({ entityType: 'sku', entityId: skuId })
  if (rows.length === 0) return <p className="text-[13px] text-muted">No audit entries for this SKU yet.</p>
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-line bg-white px-3 py-2.5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-medium text-ink-900">{row.action}</span>
            <span className="text-muted">·</span>
            <span className="text-muted">{row.field}: {row.oldValue || '—'} → {row.newValue}</span>
          </div>
          {row.reason && <div className="mt-1 text-[12px] text-muted">{row.reason}</div>}
          <div className="mt-1 text-[11px] text-muted">{new Date(row.changedAt).toLocaleString()}</div>
        </div>
      ))}
    </div>
  )
}

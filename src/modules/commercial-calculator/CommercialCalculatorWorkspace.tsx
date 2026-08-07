import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Dashboard } from './pages/Dashboard'
import { CreateBoq } from './pages/CreateBoq'
import { HierarchyView } from './pages/HierarchyView'
import { SkuCatalog } from './pages/SkuCatalog'
import { BoqManagement } from './pages/BoqManagement'
import { ProposalDetail } from './pages/ProposalDetail'
import { AuditLog } from './pages/AuditLog'
import { MasterCrudScreen } from './components/MasterCrudScreen'
import { MASTER_DEFS } from './master-defs'
import type { MasterEntityKey } from './types'

/** Commercial Calculator's tab shell — mirrors SalesWorkspace's structure
 *  (header tab strip + content area) minus the shared DetailsPanel, which is
 *  an Account Mapping concept this module doesn't use.
 *
 *  Five peer tabs, not a Work-zone-plus-one-umbrella-tab (IA review round 2,
 *  docs/superpowers/analysis/2026-08-03-commercial-calculator-ia-review-round2.md):
 *  Dashboard/Create BOQ/BOQ Management are daily-use for Sales/Pre-Sales/
 *  Managers. Catalog (Hierarchy/SKU Catalog/Product Editions) is
 *  Commercial/Product Ops's own regular workspace — grouping it with rare
 *  admin config under one "Governance" label miscast their primary job as
 *  an occasional chore, which is why that round dropped the umbrella
 *  entirely rather than renaming it again. Settings (Approval Matrix/
 *  Reference Data/Audit) is the genuinely rare, genuinely admin surface.
 *  Commercial BOM has no tab of its own: it's a per-SKU concern, edited
 *  from inside a SKU's detail page (SkuCatalog.tsx). */
const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'create-boq', label: 'Create BOQ' },
  { key: 'boq-management', label: 'BOQ Management' },
  { key: 'catalog', label: 'Catalog' },
  { key: 'settings', label: 'Settings' },
] as const

/** Flat reference lookups — no rule attached, unlike Catalog's items or
 *  Approval Matrix. Pre-Sales lives here too: a short list of names with
 *  nothing computed from it. */
const REFERENCE_MASTERS: MasterEntityKey[] = [
  'skuCategories', 'unitsOfMeasure', 'billingTypes', 'taxClasses', 'currencies', 'preSales',
]

/** Every key selectable across Catalog or Settings. `hierarchy`/
 *  `sku-catalog`/`audit` aren't `MasterEntityKey`s — they're full pages —
 *  so this key type adds exactly those three rather than inventing
 *  separate string keys for the masters, which already have perfectly
 *  good `MasterEntityKey` values reused as-is (matching how every
 *  Reference Data item already reuses its own). One shared key space and
 *  one shared content map (below) serve both tabs — only the *nav*
 *  structure (which keys are exposed as clickable items, and under which
 *  tab) differs between them. */
type CommercialItemKey = 'hierarchy' | 'sku-catalog' | 'audit' | MasterEntityKey

interface SidebarNavGroup {
  /** Omitted when a tab has exactly one group — a header naming the one
   *  and only group on the page is noise, not information. */
  label?: string
  items: { key: CommercialItemKey; label: string }[]
}

/** One content renderer per key — adding a future Catalog or Settings
 *  screen is one entry here plus one entry in whichever `_NAV` array
 *  exposes it, never new tab-strip code. `hierarchy`/`sku-catalog`/`audit`
 *  map straight to their page components (all three already take no
 *  props); every `MasterEntityKey` value wraps the generic
 *  `MasterCrudScreen`. `verticals`/`products`/`modules`/`features` aren't
 *  in either tab's sidebar directly (they're reached through the single
 *  "Hierarchy" row's tree view) but still need entries here purely so
 *  `Record<CommercialItemKey, …>` type-checks as total. */
const ITEM_CONTENT: Record<CommercialItemKey, () => JSX.Element> = {
  hierarchy: HierarchyView,
  'sku-catalog': SkuCatalog,
  verticals: () => <MasterCrudScreen masterKey="verticals" />,
  products: () => <MasterCrudScreen masterKey="products" />,
  modules: () => <MasterCrudScreen masterKey="modules" />,
  features: () => <MasterCrudScreen masterKey="features" />,
  skuCategories: () => <MasterCrudScreen masterKey="skuCategories" />,
  unitsOfMeasure: () => <MasterCrudScreen masterKey="unitsOfMeasure" />,
  productEditions: () => <MasterCrudScreen masterKey="productEditions" />,
  billingTypes: () => <MasterCrudScreen masterKey="billingTypes" />,
  taxClasses: () => <MasterCrudScreen masterKey="taxClasses" />,
  approvalMatrix: () => <MasterCrudScreen masterKey="approvalMatrix" />,
  currencies: () => <MasterCrudScreen masterKey="currencies" />,
  preSales: () => <MasterCrudScreen masterKey="preSales" />,
  audit: AuditLog,
}

/** Commercial/Product Ops's own regular workspace — "what AMNEX sells,"
 *  not occasional configuration (IA review round 2, §2/§3). One flat group:
 *  Hierarchy, SKU Catalog, and Product Editions are all curated by the same
 *  person at the same rough cadence, so there's nothing to sub-divide yet.
 *
 *  Permission seam (stakeholder request, not built — GOMS has no role
 *  concept anywhere to hook into, and an unused `readOnly` prop that
 *  nothing sets would be dead code, the same anti-pattern as the "Pricing"
 *  stub this module has already deliberately avoided elsewhere). This is
 *  additive whenever a role system exists, not a redesign, because none of
 *  the three screens below entangle browsing and editing: `HierarchyView`,
 *  `SkuCatalog`, and `MasterCrudScreen` each gate every mutation behind a
 *  specific button's `onClick` (Add/Edit/Delete/Activate, the "Features"
 *  mapping trigger) rather than inline-editable state. A future read-only
 *  mode for Sales/Pre-Sales is one `readOnly?: boolean` prop threaded into
 *  each of those three components, conditionally hiding/disabling exactly
 *  those buttons — not a rewrite of data-fetching or of this sidebar. */
const CATALOG_NAV: SidebarNavGroup[] = [
  {
    items: [
      { key: 'hierarchy', label: 'Hierarchy' },
      { key: 'sku-catalog', label: 'SKU Catalog' },
      { key: 'productEditions', label: MASTER_DEFS.productEditions.label },
    ],
  },
]

/** Genuinely rare, genuinely admin — Finance/Sales-leadership set the
 *  Approval Matrix maybe quarterly; true admins touch Reference Data and
 *  Audit almost never. Three groups because each is a different kind of
 *  rare: a high-stakes policy, a set of low-stakes lookups, and an
 *  oversight log — blending them into one undifferentiated list would
 *  recreate the "over-grouping" problem this round's review flagged,
 *  just one level down instead of at the top level. */
const SETTINGS_NAV: SidebarNavGroup[] = [
  { label: 'Approval Matrix', items: [{ key: 'approvalMatrix', label: MASTER_DEFS.approvalMatrix.label }] },
  { label: 'Reference Data', items: REFERENCE_MASTERS.map((key) => ({ key, label: MASTER_DEFS[key].label })) },
  { label: 'Audit', items: [{ key: 'audit', label: 'Audit Log' }] },
]

/** Shared by Catalog and Settings — a left sidebar (grouped, headers
 *  optional per group) and content on the right, driven by one `item`
 *  query param. Extracted once this pattern had two consumers instead of
 *  one; before the Catalog/Settings split there was only ever one
 *  Governance tab using it, so duplication wasn't yet a real cost. */
function SidebarTabPage({ groups, defaultKey }: { groups: SidebarNavGroup[]; defaultKey: CommercialItemKey }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeItem = (searchParams.get('item') as CommercialItemKey | null) ?? defaultKey
  const Content = ITEM_CONTENT[activeItem] ?? ITEM_CONTENT[defaultKey]

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-3">
        {groups.map((group, i) => (
          <div key={group.label ?? i} className="flex flex-col gap-1">
            {group.label && <h2 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.label}</h2>}
            {group.items.map((it) => (
              <button
                key={it.key}
                onClick={() => setSearchParams({ item: it.key })}
                className={cn(
                  'rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition-colors',
                  it.key === activeItem ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900',
                )}
              >
                {it.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        <Content />
      </div>
    </div>
  )
}

function CommercialCalculatorWorkspaceBody() {
  const { section, boqId } = useParams()
  const navigate = useNavigate()
  // No tab is "active" while viewing a specific BOQ — the current route
  // genuinely isn't Dashboard/Create BOQ/BOQ Management/Governance, it's the
  // shared proposal route those all lead into (IA redesign §6).
  const activeKey = boqId ? null : (SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]).key
  const goTo = (key: string) => navigate(`/commercial-calculator/${key}`)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => goTo(s.key)}
            className={cn(
              'shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              s.key === activeKey
                ? 'bg-ink-900/[0.06] text-ink-900'
                : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {boqId ? (
          <ProposalDetail boqId={boqId} />
        ) : (
          <>
            {activeKey === 'dashboard' && <Dashboard onCreateBoq={() => goTo('create-boq')} onNavigate={goTo} />}
            {activeKey === 'create-boq' && <CreateBoq onCancel={() => goTo('boq-management')} onCreated={(id) => goTo('boq/' + id)} />}
            {activeKey === 'boq-management' && <BoqManagement />}
            {activeKey === 'catalog' && <SidebarTabPage groups={CATALOG_NAV} defaultKey="hierarchy" />}
            {activeKey === 'settings' && <SidebarTabPage groups={SETTINGS_NAV} defaultKey="approvalMatrix" />}
          </>
        )}
      </div>
    </div>
  )
}

export function CommercialCalculatorWorkspace() {
  return <CommercialCalculatorWorkspaceBody />
}

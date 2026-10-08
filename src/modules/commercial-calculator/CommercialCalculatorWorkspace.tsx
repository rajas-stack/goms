import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { PolicyModuleKey } from '@goms/domain'
import { usePermissions } from '@/lib/permissions'
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
 *  Five peer tabs. Dashboard/Create BOQ/BOQ Management are daily-use for
 *  Sales/Pre-Sales/Managers. Catalog now holds only Hierarchy — SKU Catalog
 *  and Product Editions moved into Settings (2026-08-13 stakeholder
 *  direction), reopening IA review round 2's split
 *  (docs/superpowers/analysis/2026-08-03-commercial-calculator-ia-review-round2.md)
 *  on the reasoning that those two are now grouped with Settings for this
 *  round; Hierarchy/Approval Matrix/Reference Data stay exactly where they
 *  were unless a future round asks otherwise. Commercial BOM has no tab of
 *  its own: it's a per-SKU concern, edited from inside a SKU's detail page
 *  (SkuCatalog.tsx). */
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

/** Just Hierarchy now (2026-08-13: SKU Catalog and Product Editions moved
 *  into Settings, below) — kept as its own tab rather than folded away too,
 *  since nothing about the sidebar/content-map architecture requires moving
 *  it, and no such move was requested. */
const CATALOG_NAV: SidebarNavGroup[] = [
  { items: [{ key: 'hierarchy', label: 'Hierarchy' }] },
]

/** Settings — Approval Matrix/Reference Data/Audit stay exactly as IA
 *  review round 2 placed them. SKU Catalog and Product Editions join here
 *  as their own leading group (2026-08-13 stakeholder direction) rather
 *  than being folded into Reference Data or Approval Matrix — they're
 *  neither a flat lookup nor a discount rule, so they keep the same
 *  "distinct kind of screen gets its own group" principle the other three
 *  groups already follow. */
const SETTINGS_NAV: SidebarNavGroup[] = [
  { label: 'Catalog', items: [
    { key: 'sku-catalog', label: 'SKU Catalog' },
    { key: 'productEditions', label: MASTER_DEFS.productEditions.label },
  ] },
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
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex max-h-48 w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-line p-3 lg:h-auto lg:max-h-none lg:w-[220px] lg:border-b-0 lg:border-r">
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

/** Which modules open each top-level section (any one at Read or above). */
const SECTION_MODULES: Record<string, PolicyModuleKey[]> = {
  dashboard: ['com.boqs'], 'create-boq': ['com.boqs'], 'boq-management': ['com.boqs'],
  catalog: ['com.skus', 'com.masters'], settings: ['com.skus', 'com.masters', 'com.approvalMatrix', 'admin.audit'],
}

function CommercialCalculatorWorkspaceBody() {
  const { section, boqId } = useParams()
  const navigate = useNavigate()
  const perms = usePermissions()
  const canOpen = (modules: readonly PolicyModuleKey[]) => !perms.enforced || modules.some((m) => perms.level(m) !== 'N')
  const sections = SECTIONS.filter((s) => canOpen(SECTION_MODULES[s.key] ?? []))
  // The Approval Matrix and the Audit Log are their own modules inside Settings.
  const settingsNav = SETTINGS_NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => (i.key === 'approvalMatrix' ? canOpen(['com.approvalMatrix']) : i.key === 'audit' ? canOpen(['admin.audit']) : true)) }))
    .filter((g) => g.items.length > 0)
  // No tab is "active" while viewing a specific BOQ — the current route
  // genuinely isn't Dashboard/Create BOQ/BOQ Management/Governance, it's the
  // shared proposal route those all lead into (IA redesign §6).
  const activeKey = boqId ? null : (sections.find((s) => s.key === section) ?? sections[0] ?? SECTIONS[0]).key
  const goTo = (key: string) => navigate(`/commercial-calculator/${key}`)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {sections.map((s) => (
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
            {activeKey === 'settings' && <SidebarTabPage groups={settingsNav} defaultKey={settingsNav[0]?.items[0]?.key ?? 'approvalMatrix'} />}
          </>
        )}
      </div>
    </div>
  )
}

export function CommercialCalculatorWorkspace() {
  return <CommercialCalculatorWorkspaceBody />
}

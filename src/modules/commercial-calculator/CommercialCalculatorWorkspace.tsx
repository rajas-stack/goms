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
 *  Nav is Work vs. Governance (IA redesign,
 *  docs/superpowers/analysis/2026-08-03-commercial-calculator-information-architecture.md
 *  §2/§3, named "Governance" rather than "Administration" since Sales/
 *  Pre-Sales/Commercial staff configure these rules, not only IT admins):
 *  Dashboard/Create BOQ/BOQ Management are the daily-use primary tabs; SKU
 *  Catalog, the catalog-hierarchy/Product-Editions/Approval-Matrix masters,
 *  the Reference Data masters, and the Audit Log are all occasional
 *  rule-configuration surfaces collapsed behind one "Governance" tab instead
 *  of six equal peers. Commercial BOM has no tab of its own: it's a per-SKU
 *  concern, edited from inside a SKU's detail page (SkuCatalog.tsx). */
const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'create-boq', label: 'Create BOQ' },
  { key: 'boq-management', label: 'BOQ Management' },
  { key: 'governance', label: 'Governance' },
] as const

/** Flat reference lookups — no rule attached, unlike the Configuration/
 *  Commercial Rules groups below (IA redesign §3.1). Pre-Sales lives here
 *  too: a short list of names with nothing computed from it. */
const REFERENCE_MASTERS: MasterEntityKey[] = [
  'skuCategories', 'unitsOfMeasure', 'billingTypes', 'taxClasses', 'currencies', 'preSales',
]

/** Every selectable row in the Governance sidebar, grouped under four
 *  headings. `hierarchy`/`sku-catalog`/`audit` aren't `MasterEntityKey`s —
 *  they're full pages — so this key type adds exactly those three to
 *  `MasterEntityKey` rather than inventing separate string keys for Product
 *  Editions/Approval Matrix, which already have perfectly good
 *  `MasterEntityKey` values (`productEditions`/`approvalMatrix`) reused
 *  as-is, the same way every Reference Data item reuses its own. */
type GovernanceItemKey = 'hierarchy' | 'sku-catalog' | 'audit' | MasterEntityKey

interface GovernanceNavGroup {
  label: string
  items: { key: GovernanceItemKey; label: string }[]
}

/** Four groups, not one flat list — split so items with equal visual weight
 *  don't blur two different kinds of screen together:
 *    - Configuration: what exists — the catalog itself (Hierarchy, SKU
 *      Catalog). Editing here changes *what AMNEX sells*.
 *    - Commercial Rules: how it behaves — Product Editions (what a bundle
 *      contains) and the Approval Matrix (what discount needs whose
 *      sign-off). Editing here changes *the rules a sale is governed by*,
 *      not the catalog itself.
 *    - Reference Data: flat lookups, no rule attached.
 *    - Audit: oversight/history.
 *  "Pricing" (a policy screen, not built yet) would join Commercial Rules
 *  once it exists — deliberately not added as a stub. */
const GOVERNANCE_NAV: GovernanceNavGroup[] = [
  {
    label: 'Configuration',
    items: [
      { key: 'hierarchy', label: 'Hierarchy' },
      { key: 'sku-catalog', label: 'SKU Catalog' },
    ],
  },
  {
    label: 'Commercial Rules',
    items: [
      { key: 'productEditions', label: MASTER_DEFS.productEditions.label },
      { key: 'approvalMatrix', label: MASTER_DEFS.approvalMatrix.label },
    ],
  },
  {
    label: 'Reference Data',
    items: REFERENCE_MASTERS.map((key) => ({ key, label: MASTER_DEFS[key].label })),
  },
  {
    label: 'Audit',
    items: [{ key: 'audit', label: 'Audit Log' }],
  },
]

/** One content renderer per sidebar item — adding a future Governance screen
 *  is one `GOVERNANCE_NAV` entry plus one map entry here, never a new tab
 *  row. `hierarchy`/`sku-catalog`/`audit` map straight to their page
 *  components (all three already take no props); every `MasterEntityKey`
 *  value — including `productEditions`/`approvalMatrix`, and the four
 *  hierarchy masters that aren't in the sidebar directly (see
 *  `GovernanceSection`'s doc comment) — wraps the generic `MasterCrudScreen`. */
const GOVERNANCE_CONTENT: Record<GovernanceItemKey, () => JSX.Element> = {
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

/** Everything an admin/commercial-ops user needs, tucked behind one
 *  top-level tab instead of three peers alongside Dashboard/Create BOQ/BOQ
 *  Management — a single left sidebar grouped into Configuration/Commercial
 *  Rules/Reference Data/Audit, content on the right, never a second row of
 *  tabs. `verticals`/`products`/`modules`/`features` aren't listed in the
 *  sidebar (they're all reached through the single "Hierarchy" row's tree
 *  view, unchanged from before this reorg) but still need entries in
 *  `GOVERNANCE_CONTENT` above purely so `Record<GovernanceItemKey, …>`
 *  type-checks as total. */
function GovernanceSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeItem = (searchParams.get('item') as GovernanceItemKey | null) ?? 'hierarchy'
  const Content = GOVERNANCE_CONTENT[activeItem]

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-3">
        {GOVERNANCE_NAV.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <h2 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.label}</h2>
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
            {activeKey === 'governance' && <GovernanceSection />}
          </>
        )}
      </div>
    </div>
  )
}

export function CommercialCalculatorWorkspace() {
  return <CommercialCalculatorWorkspaceBody />
}

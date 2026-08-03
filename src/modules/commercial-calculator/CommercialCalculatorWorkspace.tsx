import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Dashboard } from './pages/Dashboard'
import { CreateBoq } from './pages/CreateBoq'
import { HierarchyView } from './pages/HierarchyView'
import { SkuCatalog } from './pages/SkuCatalog'
import { CommercialBom } from './pages/CommercialBom'
import { BoqManagement } from './pages/BoqManagement'
import { AuditLog } from './pages/AuditLog'
import { MasterCrudScreen } from './components/MasterCrudScreen'
import { MASTER_DEFS } from './master-defs'
import type { MasterEntityKey } from './types'

/** Commercial Calculator's tab shell — mirrors SalesWorkspace's structure
 *  (header tab strip + content area) minus the shared DetailsPanel, which is
 *  an Account Mapping concept this module doesn't use.
 *
 *  Dashboard is the landing page (spec §11) — Masters/SKU Catalog/etc. are
 *  reached from its tab strip, not the default view. */
const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'masters', label: 'Masters' },
  { key: 'sku-catalog', label: 'SKU Catalog' },
  { key: 'commercial-bom', label: 'Commercial BOM' },
  { key: 'boq-management', label: 'BOQ Management' },
  { key: 'audit-log', label: 'Audit Log' },
] as const

type MasterGroup = 'hierarchy' | 'commercial' | 'administration'
const MASTER_GROUPS: { key: MasterGroup; label: string; masters: MasterEntityKey[] }[] = [
  { key: 'hierarchy', label: 'Hierarchy', masters: ['verticals', 'products', 'modules', 'features'] },
  { key: 'commercial', label: 'Commercial', masters: ['skuCategories', 'unitsOfMeasure', 'billingTypes', 'taxClasses', 'currencies'] },
  { key: 'administration', label: 'Administration', masters: ['approvalMatrix', 'productEditions', 'preSales'] },
]

function MastersSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeGroup = (searchParams.get('group') as MasterGroup | null) ?? 'hierarchy'
  const group = MASTER_GROUPS.find((g) => g.key === activeGroup) ?? MASTER_GROUPS[0]
  const activeMaster = (searchParams.get('master') as MasterEntityKey | null) ?? group.masters[0]

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-2">
        {MASTER_GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setSearchParams({ group: g.key, ...(g.key !== 'hierarchy' ? { master: g.masters[0] } : {}) })}
            className={cn(
              'shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
              g.key === activeGroup ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      {activeGroup === 'hierarchy' ? (
        <div className="min-h-0 flex-1"><HierarchyView /></div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5">
            {group.masters.map((key) => (
              <button
                key={key}
                onClick={() => setSearchParams({ group: activeGroup, master: key })}
                className={cn(
                  'shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors',
                  key === activeMaster ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900',
                )}
              >
                {MASTER_DEFS[key].label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <MasterCrudScreen masterKey={activeMaster} />
          </div>
        </>
      )}
    </div>
  )
}

function CommercialCalculatorWorkspaceBody() {
  const { section } = useParams()
  const navigate = useNavigate()
  const [creatingBoq, setCreatingBoq] = useState(false)
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]

  if (creatingBoq) {
    return <CreateBoq onDone={() => { setCreatingBoq(false); navigate('/commercial-calculator/boq-management') }} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            to={`/commercial-calculator/${s.key}`}
            className={cn(
              'shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              s.key === active.key
                ? 'bg-ink-900/[0.06] text-ink-900'
                : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900',
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {active.key === 'dashboard' && (
          <Dashboard onCreateBoq={() => setCreatingBoq(true)} onNavigate={(s) => navigate(`/commercial-calculator/${s}`)} />
        )}
        {active.key === 'masters' && <MastersSection />}
        {active.key === 'sku-catalog' && <SkuCatalog />}
        {active.key === 'commercial-bom' && <CommercialBom />}
        {active.key === 'boq-management' && <BoqManagement />}
        {active.key === 'audit-log' && <AuditLog />}
      </div>
    </div>
  )
}

export function CommercialCalculatorWorkspace() {
  return <CommercialCalculatorWorkspaceBody />
}

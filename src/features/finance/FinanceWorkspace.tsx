import { NavLink, Navigate, useParams } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { definePermissionNodes } from '@/lib/rbacTree/registry'
import { useNodeFilter } from '@/lib/rbacTree/access'
import { ReimbursementsPage } from './reimbursements/ReimbursementsPage'

/** Finance tabs, in order. Each is a permission-tree node `finance.<value>`. */
export const FINANCE_TABS = definePermissionNodes('finance', [
  { value: 'reimbursements', label: 'Reimbursements', icon: 'Receipt', path: '/finance/reimbursements' },
] as const)
export type FinanceTab = (typeof FINANCE_TABS)[number]['value']

/** The Finance module: one page per tab, laid out like Opportunity's sheet bar. */
export function FinanceWorkspace() {
  const { tab } = useParams()
  const treeAllows = useNodeFilter()
  const visibleTabs = FINANCE_TABS.filter((t) => treeAllows(`finance.${t.value}`))
  if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.value === tab)) return <Navigate to={visibleTabs[0].path} replace />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Finance pages" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-paper/70 px-3 py-1.5">
        {visibleTabs.map((t) => (
          <NavLink key={t.value} to={t.path} title={t.label} className="flex-none">
            <div
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors',
                t.value === tab ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink-600/70 hover:bg-ink-900/[0.05] hover:text-ink-900',
              )}
              aria-current={t.value === tab ? 'page' : undefined}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </div>
          </NavLink>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {tab === 'reimbursements' && <ReimbursementsPage />}
      </div>
    </div>
  )
}

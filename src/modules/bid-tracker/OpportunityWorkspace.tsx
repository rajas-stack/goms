import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Tabs } from '@/components/ui/Tabs'
import { cn } from '@/lib/utils'
import { BidTrackerWorkspace } from './BidTrackerWorkspace'
import { GridSheet } from './GridSheet'
import { DashboardPage } from './pages/DashboardPage'
import { OPPORTUNITY_TABS, PIPELINE_TABS, type OpportunityTab, type PipelineTab } from './sheets'
import { usePermissions } from '@/lib/permissions'
import { OPPORTUNITY_TAB_MODULES } from '@/lib/routeModules'

/** The Opportunity module: Bid Tracker, Pipeline (Funnel / Backup / Commits),
 *  Campaign, Master and Dashboard. Laid out like Account Mapping's Map / Directory /
 *  Insights / Meetings bar. Every sheet is the same Excel-style grid (custom
 *  columns, filters, freeze, lock) with its own saved views, over the rows that
 *  live in it; Master lists every sheet's rows and Dashboard summarises them. */
export function OpportunityWorkspace({ tab }: { tab: OpportunityTab }) {
  const { tab: pipelineParam } = useParams()
  const navigate = useNavigate()
  const pipeline = PIPELINE_TABS.find((t) => t.value === pipelineParam)
  const perms = usePermissions()
  // A tab follows its sheet's read permission; a direct hit on a hidden tab lands on the first visible one.
  const visibleTabs = OPPORTUNITY_TABS.filter((t) => !perms.enforced || (OPPORTUNITY_TAB_MODULES[t.value] ?? []).some((m) => perms.level(m) !== 'N'))
  if (perms.enforced && visibleTabs.length > 0 && !visibleTabs.some((t) => t.value === tab)) return <Navigate to={visibleTabs[0].path} replace />
  if (tab === 'pipeline' && !pipeline) return <Navigate to="/bid-tracker/pipeline/funnel" replace />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Opportunity sheets" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-paper/70 px-3 py-1.5">
        {visibleTabs.map((t) => (
          <NavLink key={t.value} to={t.path} end={t.value === 'bid-tracker'} title={t.label} className="flex-none">
            {() => (
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
            )}
          </NavLink>
        ))}
      </nav>

      {tab === 'pipeline' && pipeline && (
        <Tabs<PipelineTab>
          value={pipeline.value}
          onChange={(v) => navigate(`/bid-tracker/pipeline/${v}`)}
          tabs={PIPELINE_TABS.map(({ value, label }) => ({ value, label }))}
        />
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'bid-tracker' && <BidTrackerWorkspace />}
        {tab === 'pipeline' && pipeline && <GridSheet key={pipeline.sheet} sheet={pipeline.sheet} />}
        {tab === 'campaign' && <GridSheet sheet="campaign" />}
        {tab === 'master' && <GridSheet sheet="master" />}
        {tab === 'dashboard' && <DashboardPage />}
      </div>
    </div>
  )
}

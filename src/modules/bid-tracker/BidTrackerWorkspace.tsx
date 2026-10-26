import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Tabs } from '@/components/ui/Tabs'
import { GridSheet } from './GridSheet'
import { MilestonesDatesPage } from './pages/MilestonesDatesPage'
import { ActionQueuePage } from './pages/ActionQueuePage'
import { ActivityHistoryPage } from './pages/ActivityHistoryPage'
import { definePermissionNodes } from '@/lib/rbacTree/registry'
import { useNodeFilter } from '@/lib/rbacTree/access'
import { NoAccess } from '@/components/NoAccess'

const SECTIONS_PARENT = 'opportunity.bid-tracker'
const SECTIONS = definePermissionNodes(SECTIONS_PARENT, [
  { value: 'grid', label: 'Master Grid' },
  { value: 'milestones', label: 'Milestones & Dates' },
  { value: 'actions', label: 'Action Queue' },
  { value: 'history', label: 'Activity History' },
] as const, { kind: 'subtab' })

type Section = (typeof SECTIONS)[number]['value']

/** The Live Bids sheet of the Opportunity module: its own four sections, the
 *  first being the Excel-style Master Grid (`GridSheet`). */
export function BidTrackerWorkspace() {
  const { section = 'grid' } = useParams()
  const navigate = useNavigate()
  const allowed = useNodeFilter()
  const visible = SECTIONS.filter((s) => allowed(`${SECTIONS_PARENT}.${s.value}`))
  if (visible.length === 0) return <NoAccess />
  if (!visible.some((s) => s.value === section)) {
    const first = visible[0].value
    return <Navigate to={first === 'grid' ? '/live-bids' : `/live-bids/${first}`} replace />
  }

  return (
    <div className="flex h-full flex-col">
      <Tabs<Section>
        value={section as Section}
        onChange={(v) => navigate(v === 'grid' ? '/live-bids' : `/live-bids/${v}`)}
        tabs={visible.map(({ value, label }) => ({ value, label }))}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {section === 'grid' && <GridSheet sheet="bidTracker" />}
        {section === 'milestones' && <MilestonesDatesPage />}
        {section === 'actions' && <ActionQueuePage />}
        {section === 'history' && <ActivityHistoryPage />}
      </div>
    </div>
  )
}

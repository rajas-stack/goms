import { useNavigate, useParams } from 'react-router-dom'
import { Tabs } from '@/components/ui/Tabs'
import { GridSheet } from './GridSheet'
import { MilestonesDatesPage } from './pages/MilestonesDatesPage'
import { ActionQueuePage } from './pages/ActionQueuePage'
import { ActivityHistoryPage } from './pages/ActivityHistoryPage'

const SECTIONS = [
  { value: 'grid', label: 'Master Grid' },
  { value: 'milestones', label: 'Milestones & Dates' },
  { value: 'actions', label: 'Action Queue' },
  { value: 'history', label: 'Activity History' },
] as const

type Section = (typeof SECTIONS)[number]['value']

/** The Bid Tracker sheet of the Opportunity module: its own four sections, the
 *  first being the Excel-style Master Grid (`GridSheet`). */
export function BidTrackerWorkspace() {
  const { section = 'grid' } = useParams()
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <Tabs<Section>
        value={section as Section}
        onChange={(v) => navigate(v === 'grid' ? '/bid-tracker' : `/bid-tracker/${v}`)}
        tabs={SECTIONS.map(({ value, label }) => ({ value, label }))}
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

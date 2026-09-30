import { useNavigate, useParams } from 'react-router-dom'
import { Tabs } from '@/components/ui/Tabs'
import { MasterGrid } from './components/MasterGrid'

const SECTIONS = [
  { value: 'grid', label: 'Master Grid' },
  { value: 'milestones', label: 'Milestones & Dates' },
  { value: 'actions', label: 'Action Queue' },
  { value: 'history', label: 'Activity History' },
] as const

type Section = (typeof SECTIONS)[number]['value']

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
        {/* Task 29 supplies the active saved view (its filter rules and ordered
            columns) to the grid; until then the grid holds its own state.
            Task 35 (actions), Task 36 (history) fill in the other sections;
            milestones content arrives with Task 31. */}
        {section === 'grid' && <MasterGrid />}
      </div>
    </div>
  )
}

import { useNavigate, useParams } from 'react-router-dom'
import { Tabs } from '@/components/ui/Tabs'

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
      <div className="flex-1 overflow-auto">
        {/* Task 28 (grid), Task 35 (actions), Task 36 (history) fill these in;
            milestones content arrives with Task 31. */}
        {section === 'grid' && <div data-testid="bid-tracker-grid-placeholder" />}
      </div>
    </div>
  )
}

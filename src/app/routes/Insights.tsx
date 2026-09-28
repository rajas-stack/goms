import { useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { SalesTeamInsights } from './SalesTeamInsights'
import { RelationshipAnalytics } from './RelationshipAnalytics'

const TABS = [
  { value: 'salesTeam', label: 'Sales Team Insights' },
  { value: 'relationships', label: 'Relationship Analytics' },
] as const

export function Insights() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('salesTeam')

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-paper/70 px-3 pt-2 sm:px-6">
        <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'salesTeam' ? <SalesTeamInsights /> : <RelationshipAnalytics />}
      </div>
    </div>
  )
}

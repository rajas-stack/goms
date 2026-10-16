import type { ReactNode } from 'react'
import { insightGroups, insightIsOpen, PIPELINE_STAGE_MAP, type InsightGroup, type InsightRecord, type InsightsData } from '@goms/domain'
import { Bars, Frame, money } from './InsightCharts'
import { Segment, STATUS } from './InsightTables'

export function SpecialtyView({ tab, data, count, setMeasure, pick, drill, stagePanel, trendPanel, recentPanel }: {
  tab: string; data: InsightsData; count: boolean; setMeasure: (v: string) => void; pick: (g: InsightGroup) => void; drill: (title: string, rows: InsightRecord[]) => void; stagePanel: ReactNode; trendPanel: ReactNode; recentPanel: ReactNode
}) {
  const groupFrame = (title: string, groups: InsightGroup[], asCount = count) => <Frame title={title} actions={<Segment label={`${title} measure`} options={['Value', 'Count']} value={count ? 'Count' : 'Value'} onChange={setMeasure}/>}><Bars groups={groups} count={asCount} onPick={pick} limit={12}/></Frame>
  if (tab === 'sales') return <div className="insight-special-grid">{groupFrame('Opportunities by Sales Owner', data.owners)}{trendPanel}{recentPanel}</div>
  if (tab === 'presales') return <div className="insight-special-grid">{groupFrame('Presales Opportunity Load', data.presales)}{stagePanel}{recentPanel}</div>
  if (tab === 'bids') return <div className="insight-special-grid">{stagePanel}{groupFrame('Bid Attention', data.attention.map(g => ({ ...g, label: STATUS[g.key] ?? g.label })))}{recentPanel}</div>
  if (tab === 'revenue') {
    const wins = data.records.filter(r => PIPELINE_STAGE_MAP[r.opportunityStageKey]?.isWon)
    return <div className="insight-special-grid"><Frame title="Won Opportunity Value"><button className="insight-revenue-total" title="Won opportunity value, not invoiced or recognized revenue" onClick={() => drill('Won opportunities', wins)}>{money(data.metrics.wonValue)}<span>{data.metrics.won} won opportunities</span></button></Frame>{groupFrame('Won Value by Department', insightGroups(wins, r => r.department))}{trendPanel}{recentPanel}</div>
  }
  if (tab === 'competitors') return <div className="insight-special-grid">{groupFrame('Recorded Competitor Exposure', data.competitors)}<Frame title="Competition Coverage"><Bars groups={insightGroups(data.records, r => r.competitors.length ? 'Competition recorded' : 'No competition recorded')} count onPick={pick}/></Frame>{recentPanel}</div>
  if (tab === 'team') return <div className="insight-special-grid">{groupFrame('Bid Team Workload', data.team)}{groupFrame('Presales Workload', data.presales)}{groupFrame('Sales Ownership', data.owners)}{recentPanel}</div>
  const weighted = data.records.filter(insightIsOpen).map(r => ({ ...r, valueCr: r.valueCr === null ? null : r.valueCr * (PIPELINE_STAGE_MAP[r.opportunityStageKey]?.probability ?? 0) }))
  const quarter = (r: InsightRecord) => r.dueAt && !Number.isNaN(Date.parse(r.dueAt)) ? `${new Date(r.dueAt).getUTCFullYear()} Q${Math.floor(new Date(r.dueAt).getUTCMonth() / 3) + 1}` : 'Unscheduled'
  return <div className="insight-special-grid">{groupFrame('Pipeline by Due Quarter', data.forecast)}{groupFrame('Weighted Forecast by Due Quarter', insightGroups(weighted, quarter))}{groupFrame('Forecast by Sales Owner', insightGroups(weighted, r => r.owner))}{recentPanel}</div>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BID_STAGE_MAP, PIPELINE_STAGE_MAP, computeInsights, insightIsOpen, type InsightGroup, type InsightRecord, type InsightTrend } from '@goms/domain'
import { useInsights } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Dialog } from '@/components/ui/Dialog'
import { useShell } from '@/app/AppLayout'
import { definePermissionNodes } from '@/lib/rbacTree/registry'
import { useNodeFilter } from '@/lib/rbacTree/access'
import { downloadCsv, toCsv } from '@/lib/csv'
import { RelationshipAnalytics } from '@/app/routes/RelationshipAnalytics'
import { Bars, DonutChart, Frame, IndiaMap, money, Sparkline, StageChart, stateName, TrendChart } from './InsightCharts'
import { bidUrl, DetailList, RecentTable, Segment, STATUS } from './InsightTables'
import { SpecialtyView } from './InsightSpecialty'
import { createInsightDemoRecords } from './demoData'
import { DemoOpportunity } from './DemoOpportunity'
import { StudioMenu } from '@/features/insights-studio/StudioMenu'
import './insights.css'

export const INSIGHT_TABS = definePermissionNodes('accountMapping.insights', [
  { value: 'overview', label: 'Overview' }, { value: 'sales', label: 'Sales' }, { value: 'presales', label: 'Presales' },
  { value: 'bids', label: 'Bids' }, { value: 'revenue', label: 'Revenue' }, { value: 'competitors', label: 'Competitors' },
  { value: 'team', label: 'Team' }, { value: 'forecast', label: 'Forecast' },
  { value: 'relationships', label: 'Relationship Analytics' },
] as const)
function quarterlyTrend(data: InsightTrend[]) {
  const groups = new Map<string, InsightTrend>()
  for (const d of data) {
    const date = new Date(d.key), quarter = Math.floor(date.getUTCMonth() / 3), key = `${date.getUTCFullYear()}-${String(quarter * 3 + 1).padStart(2, '0')}-01`
    const existing = groups.get(key)
    if (!existing) groups.set(key, { ...d, key, label: `Q${quarter + 1} ${String(date.getUTCFullYear()).slice(2)}` })
    else for (const field of ['value', 'pipeline', 'count', 'wonValue', 'wonCount', 'lostValue', 'lostCount', 'weighted', 'active'] as const) existing[field] += d[field]
  }
  return [...groups.values()]
}
function Delta({ current, previous, percent = false }: { current: number | null; previous: number | null; percent?: boolean }) {
  if (previous === null || current === null || previous === 0 && current !== 0) return <span className="insight-baseline">No prior baseline</span>
  const change = percent ? current - previous : previous ? (current - previous) / previous * 100 : 0
  return <span className={change < 0 ? 'insight-negative' : 'insight-positive'}><Icon name={change < 0 ? 'ArrowDown' : 'ArrowUp'} size={12}/>{change > 0 ? '+' : ''}{change.toFixed(1)}{percent ? ' pp' : '%'} <span>vs prior intake</span></span>
}
export function Insights() {
  const [params, setParams] = useSearchParams(), tree = useNodeFilter(), shell = useShell()
  const tabs = INSIGHT_TABS.filter(t => tree(`accountMapping.insights.${t.value}`))
  const requested = params.get('tab'), tab = tabs.find(t => t.value === requested)?.value ?? tabs[0]?.value ?? 'overview'
  const legacy = tab === 'relationships'
  const [savedDemo, setSavedDemo] = useState(() => { try { return localStorage.getItem('goms.insights.sampleData') !== '0' } catch { return true } })
  const demoParam = params.get('demo'), demo = demoParam === null ? savedDemo : demoParam === '1'
  useEffect(() => { setSavedDemo(demo); try { localStorage.setItem('goms.insights.sampleData', demo ? '1' : '0') } catch { /* Storage may be disabled. */ } }, [demo])
  const [demoRevision, setDemoRevision] = useState(0)
  const rawMonths = Number(params.get('months') ?? 12), months = [0, 3, 6, 12, 24].includes(rawMonths) ? rawMonths : 12
  const state = params.get('state'), stateCode = state !== null && /^\d{1,2}$/.test(state) ? Number(state) : undefined
  const filters = useMemo(() => ({ months, vertical: params.get('vertical') || undefined, stateCode, search: params.get('q') || undefined }), [months, params, stateCode])
  const liveQuery = useInsights(filters, !demo && !legacy && tabs.length > 0)
  const demoData = useMemo(() => demo && !legacy ? computeInsights(createInsightDemoRecords(), filters) : undefined, [demo, legacy, filters, demoRevision])
  const query = { ...liveQuery, isLoading: !demo && liveQuery.isLoading, isError: !demo && liveQuery.isError, isFetching: !demo && liveQuery.isFetching }
  const data = demo ? demoData : liveQuery.data
  const refresh = () => { if (demo) setDemoRevision(value => value + 1); else void query.refetch() }
  const pendingParams = useRef(params)
  useEffect(() => { pendingParams.current = params }, [params])
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(pendingParams.current)
    if (value) next.set(key, value); else next.delete(key)
    pendingParams.current = next
    setParams(next, { flushSync: true })
  }
  const clearFilters = () => { const next = new URLSearchParams({ tab, ...(demo ? { demo: '1' } : {}) }); pendingParams.current = next; setParams(next, { flushSync: true }) }
  const changeData = (sample: boolean) => { const next = new URLSearchParams({ tab, months: String(months), demo: sample ? '1' : '0' }); pendingParams.current = next; setParams(next, { flushSync: true }) }
  const [measure, setMeasure] = useState('Value'), [period, setPeriod] = useState('Monthly'), [stageMeasure, setStageMeasure] = useState('Both'), [departmentLimit, setDepartmentLimit] = useState('7')
  const [detail, setDetail] = useState<{ title: string; records: InsightRecord[] } | null>(null), [actions, setActions] = useState<InsightRecord | null>(null), [exportError, setExportError] = useState<string | null>(null)
  const [preview, setPreview] = useState<InsightRecord | null>(null)
  useEffect(() => { setDetail(null); setActions(null); setPreview(null); setExportError(null) }, [demo])
  const openDemo = (record: InsightRecord) => { setDetail(null); setPreview(record) }
  const rowActions = demo ? openDemo : setActions
  const drill = (title: string, records: InsightRecord[]) => setDetail({ title, records })
  const pick = (g: InsightGroup) => { const ids = new Set(g.ids); drill(g.label, data?.records.filter(r => ids.has(r.id)) ?? []) }
  const metricInfo = 'Current values and stages of opportunities created in the selected period, compared with the preceding creation cohort. Not historical pipeline snapshots. Monetary totals include only recorded INR values with known units.'
  const exportData = async () => {
    if (!data) return
    setExportError(null)
    try { await downloadCsv(`insights-${demo ? 'sample-' : ''}${tab}-${data.asOf}.csv`, toCsv([['Opportunity', 'Department', 'State', 'Vertical', 'Value (INR Cr)', 'Stage', 'Status', 'Sales owner', 'Presales', 'Bid team'], ...data.records.map(r => [r.name, r.department, stateName(String(r.stateCode ?? 'unassigned')), r.vertical, r.valueCr === null ? '' : String(r.valueCr), BID_STAGE_MAP[r.stageKey]?.label ?? r.stageKey, STATUS[r.attentionFlag], r.owner, r.presales, r.team])])) }
    catch { setExportError('The export could not be saved. Please retry.') }
  }
  const trend = data ? period === 'Quarterly' ? quarterlyTrend(data.trend) : data.trend : []
  const trendPick = (key: string, kind: 'new' | 'won' | 'lost') => {
    const end = new Date(`${key}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + (period === 'Quarterly' ? 3 : 1))
    drill(kind === 'new' ? 'New opportunities' : kind === 'won' ? 'Closed (Won)' : 'Closed (Lost)', data?.eventRecords.filter(r => {
      const date = kind === 'new' ? r.createdAt : r.closedOn
      return !!date && date.slice(0, 10) >= key && date.slice(0, 10) < end.toISOString().slice(0, 10) && (kind === 'new' || kind === 'won' && PIPELINE_STAGE_MAP[r.opportunityStageKey]?.isWon || kind === 'lost' && r.opportunityStageKey === 'lost')
    }) ?? [])
  }
  const recent = data ? data.records.filter(r => r.sheet === 'bidTracker').sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name)) : []
  const top = data?.records.filter(insightIsOpen).sort((a, b) => (b.valueCr ?? -1) - (a.valueCr ?? -1))[0]
  const growth = data?.previous && data.previous.pipeline > 0 ? (data.metrics.pipeline - data.previous.pipeline) / data.previous.pipeline * 100 : null
  const rateChange = data?.metrics.winRate !== null && data?.metrics.winRate !== undefined && data.previous?.winRate !== null && data.previous?.winRate !== undefined ? data.metrics.winRate - data.previous.winRate : null
  const count = measure === 'Count'
  const stagePanel = data && <Frame title="Opportunity Pipeline by Stage" className="insight-stage-frame" actions={<div className="insight-stage-legend" role="group" aria-label="Stage measures">
    <button aria-pressed={stageMeasure !== 'Count'} disabled={stageMeasure === 'Value'} onClick={() => setStageMeasure(stageMeasure === 'Both' ? 'Count' : 'Both')}><i className="insight-stage-swatch-value"/>Value ({'\u20b9'} Cr)</button>
    <button aria-pressed={stageMeasure !== 'Value'} disabled={stageMeasure === 'Count'} onClick={() => setStageMeasure(stageMeasure === 'Both' ? 'Value' : 'Both')}><i className="insight-stage-swatch-count"/>Count</button>
  </div>}><div className="insight-unit">{stageMeasure === 'Count' ? 'Number of opportunities' : `Value in \u20b9 Crore`}</div><StageChart groups={data.stages} showValue={stageMeasure !== 'Count'} showCount={stageMeasure !== 'Value'} onPick={pick} valueStages={new Set(data.records.filter(r => r.valueCr !== null).map(r => r.stageKey))}/></Frame>
  const trendPanel = <Frame title="Opportunity Trend" actions={<div className="insight-chart-controls"><Segment label="Trend interval" options={['Monthly', 'Quarterly']} value={period} onChange={setPeriod}/><Segment label="Trend measure" options={['Value', 'Count']} value={measure} onChange={setMeasure}/></div>}><TrendChart data={trend} count={count} onPick={trendPick}/></Frame>
  const recentPanel = <Frame title="Recent Opportunities" actions={<button className="insight-small-button" onClick={() => drill('All opportunities', recent)}>View All</button>}><RecentTable rows={recent.slice(0, 5)} onActions={rowActions} onOpen={demo ? openDemo : undefined}/></Frame>
  if (!tabs.length) return <div role="alert" className="insight-error">You do not have access to any Insights view.</div>
  return <div className="insights-page" data-testid="insights-page">
    <nav className="insight-tabs" aria-label="Insights views">{tabs.map(t => <button key={t.value} aria-current={tab === t.value ? 'page' : undefined} onClick={() => update('tab', t.value)}>{t.label}</button>)}</nav>
    {legacy ? <div className="insight-legacy"><RelationshipAnalytics/></div> : <>
      <header className="insight-toolbar"><div className="insight-heading"><h1>Insights</h1><span className={demo ? 'insight-demo-badge' : 'insight-live-badge'}>{demo ? 'Sample data' : 'Live data'}</span></div><label className="insight-demo-toggle"><input type="checkbox" role="switch" aria-label="Use sample data" checked={demo} onChange={e => changeData(e.target.checked)}/>Sample data</label><div className="insight-filters">
        <select aria-label="Insights period" value={months} onChange={e => update('months', e.target.value)}>{[[3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months'], [24, 'Last 24 months'], [0, 'All time']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Insights vertical" value={filters.vertical ?? ''} onChange={e => update('vertical', e.target.value)}><option value="">All Verticals</option>{data?.options.verticals.map(v => <option key={v}>{v}</option>)}{filters.vertical && !data?.options.verticals.includes(filters.vertical) && <option>{filters.vertical}</option>}</select>
        <select aria-label="Insights state" value={stateCode ?? ''} onChange={e => update('state', e.target.value)}><option value="">All States</option>{data?.options.states.map(s => <option key={s} value={s}>{stateName(String(s))}</option>)}{stateCode !== undefined && !data?.options.states.includes(stateCode) && <option value={stateCode}>{stateName(String(stateCode))}</option>}</select>
        <input aria-label="Search insights" maxLength={200} placeholder="Find opportunity..." value={filters.search ?? ''} onChange={e => update('q', e.target.value)}/>
        {(filters.vertical || stateCode !== undefined || filters.search || months !== 12) && <button title="Clear filters" aria-label="Clear insights filters" className="insight-icon-button" onClick={clearFilters}><Icon name="X"/></button>}
      </div><div className="insight-toolbar-actions"><button title="Refresh insights" aria-label="Refresh insights" disabled={query.isFetching} onClick={refresh}><Icon name={query.isFetching ? 'Loader' : 'RotateCcw'} size={15}/></button><button onClick={shell.openImport} disabled={demo} title={demo ? 'Import is available with live data' : 'Import'}><Icon name="Upload" size={14}/>Import</button>{tree('accountMapping.insights', 'download') && <button onClick={() => void exportData()} disabled={!data}><Icon name="Download" size={14}/>Export</button>}<StudioMenu/></div></header>
      {exportError && <div role="alert" className="insight-error">{exportError}</div>}
      {query.isLoading ? <div role="status" className="insight-loading">Loading insights...</div> : query.isError ? <div role="alert" className="insight-error">Insights could not be loaded. Check your access and connection. <button onClick={() => void query.refetch()}>Retry</button></div> : data && <div className="insight-body">
        <section className="insight-kpis" aria-label="Headline statistics">{[
          { label: 'Total Pipeline', icon: 'BarChart3', value: money(data.metrics.pipeline), current: data.metrics.pipeline, previous: data.previous?.pipeline ?? null, series: data.trend.map(t => t.pipeline), records: data.records.filter(insightIsOpen) },
          { label: 'Weighted Pipeline', icon: 'CircleDot', value: money(data.metrics.weighted), current: data.metrics.weighted, previous: data.previous?.weighted ?? null, series: data.trend.map(t => t.weighted), records: data.records.filter(insightIsOpen) },
          { label: 'Bid Win Rate', icon: 'Flag', value: data.metrics.winRate === null ? 'Not available' : `${data.metrics.winRate.toFixed(1)}%`, current: data.metrics.winRate, previous: data.previous?.winRate ?? null, series: data.trend.map(t => t.winRate), records: data.records.filter(r => PIPELINE_STAGE_MAP[r.opportunityStageKey]?.isWon || r.opportunityStageKey === 'lost') },
          { label: 'Active Opportunities', icon: 'FileText', value: String(data.metrics.active), current: data.metrics.active, previous: data.previous?.active ?? null, series: data.trend.map(t => t.active), records: data.records.filter(insightIsOpen) },
        ].map(k => <button key={k.label} className="insight-kpi" onClick={() => drill(k.label, k.records)}><span className="insight-kpi-icon"><Icon name={k.icon} size={26}/></span><span className="insight-kpi-content"><span className="insight-kpi-label">{k.label}<span title={metricInfo} aria-label={`${k.label} definition`}><Icon name="CircleAlert" size={12}/></span></span><strong>{k.value}</strong><Delta current={k.current} previous={k.previous} percent={k.label === 'Bid Win Rate'}/></span><Sparkline values={k.series} label={k.label} periods={data.trend.map(t => t.label)} format={k.label.includes('Pipeline') ? money : k.label === 'Bid Win Rate' ? n => `${n.toFixed(1)}%` : String}/></button>)}</section>
        {tab === 'overview' ? <div className="insight-overview-grid">
          {stagePanel}<Frame title="Pipeline by Vertical"><DonutChart groups={data.verticals} onPick={pick}/></Frame>
          <Frame title="Pipeline by Department" actions={<select aria-label="Department ranking" value={departmentLimit} onChange={e => setDepartmentLimit(e.target.value)}><option value="7">Top Departments</option><option value="10">Top 10 Departments</option><option value="9999">All Departments</option></select>}><Bars groups={data.departments} onPick={pick} limit={Number(departmentLimit)}/></Frame>
          {trendPanel}<Frame title="Geographic Distribution"><div className="insight-geography"><IndiaMap groups={data.states} selected={stateCode} onSelect={code => update('state', code === stateCode ? '' : String(code))}/><Bars groups={data.states} onPick={pick} labels={g => stateName(g.key)} limit={6}/></div></Frame>{recentPanel}
        </div> : <SpecialtyView tab={tab} data={data} count={count} setMeasure={setMeasure} pick={pick} drill={drill} stagePanel={stagePanel} trendPanel={trendPanel} recentPanel={recentPanel}/>}
        <section className="insight-summary" aria-label="Key Insights"><div className="insight-summary-heading"><Icon name="Sparkles" size={28}/><strong>Key Insights</strong></div>
          <button onClick={() => drill('Active pipeline', data.records.filter(insightIsOpen))}><Icon name="TrendingUp"/><span><strong>{growth === null ? `${money(data.metrics.pipeline)} pipeline` : `Pipeline ${growth >= 0 ? 'grew' : 'declined'} by ${Math.abs(growth).toFixed(1)}%`}</strong><small>{data.previous ? `${money(data.metrics.pipeline)} vs ${money(data.previous.pipeline)} in prior intake` : 'All-time intake'}</small></span></button>
          <button onClick={() => drill('Closed opportunities', data.records.filter(r => PIPELINE_STAGE_MAP[r.opportunityStageKey]?.isClosed))}><Icon name="Flag"/><span><strong>{rateChange === null ? `${data.metrics.won} won / ${data.metrics.lost} lost` : `Win rate ${rateChange >= 0 ? 'improved' : 'declined'} ${Math.abs(rateChange).toFixed(1)} pp`}</strong><small>{data.metrics.winRate === null ? 'No decided outcomes' : `${data.metrics.winRate.toFixed(1)}% win rate${data.previous?.winRate == null ? '' : ` vs ${data.previous.winRate.toFixed(1)}% in prior intake`}`}</small></span></button>
          <button onClick={() => drill('Opportunities needing attention', data.records.filter(r => insightIsOpen(r) && r.attentionFlag !== 'onTrack'))}><Icon name="TriangleAlert"/><span><strong>{money(data.metrics.atRiskValue)} at risk</strong><small>{data.metrics.atRisk} opportunities need attention</small></span></button>
          {top ? demo ? <button onClick={() => openDemo(top)}><Icon name="Lightbulb"/><span><strong>Top opportunity</strong><small>{top.name} ({top.valueCr === null ? 'Value not recorded' : money(top.valueCr)})</small></span></button> : <Link to={bidUrl(top.id)}><Icon name="Lightbulb"/><span><strong>Top opportunity</strong><small>{top.name} ({top.valueCr === null ? 'Value not recorded' : money(top.valueCr)})</small></span></Link> : <div><Icon name="Lightbulb"/><span>No active opportunity</span></div>}
        </section><div className="insight-asof" title={metricInfo}>As of {data.asOf}{data.metrics.unpriced ? ` / ${data.metrics.unpriced} records without a usable INR value` : ''}</div>
      </div>}
    </>}
    {detail && <DetailList key={detail.title + detail.records.map(r => r.id).join(',')} title={`${demo ? 'Sample: ' : ''}${detail.title}`} records={detail.records} onClose={() => setDetail(null)} onActions={rowActions} onOpen={demo ? openDemo : undefined}/>}
    {demo && preview && <DemoOpportunity key={preview.id} record={preview} onClose={() => setPreview(null)}/>}
    {actions && <Dialog open title={actions.name} onClose={() => setActions(null)}><div className="insight-action-links">{[['overview', 'Open Overview'], ['general', 'Open General'], ['competition', 'Open Competition']].map(([section, label]) => <Link key={section} to={bidUrl(actions.id, section)}>{label}<Icon name="ArrowRight"/></Link>)}</div></Dialog>}
  </div>
}

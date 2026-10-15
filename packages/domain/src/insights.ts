import { BID_STAGE_MAP, type BidAttentionFlag, type OwnedSheet } from './bids.js'
import { PIPELINE_STAGE_MAP } from './opportunities.js'
import type { SynopsisNode } from './bidSynopsis.js'
import type { SynopsisGrid } from './synopsisGrid.js'

export interface InsightsFilters { months: number; vertical?: string; stateCode?: number; search?: string }
export interface InsightRecord {
  id: string; opportunityId: string; name: string; department: string; vertical: string; stateCode: number | null
  stageKey: string; opportunityStageKey: string; sheet: OwnedSheet; status: string; attentionFlag: BidAttentionFlag
  createdAt: string; closedOn: string | null; dueAt: string | null; valueCr: number | null
  owner: string; presales: string; team: string; competitors: string[]
}
export interface InsightGroup { key: string; label: string; value: number; count: number; ids: string[] }
export interface InsightTrend { key: string; label: string; value: number; pipeline: number; count: number; wonValue: number; wonCount: number; lostValue: number; lostCount: number; weighted: number; active: number; winRate: number }
export interface InsightMetrics { pipeline: number; weighted: number; winRate: number | null; active: number; won: number; lost: number; wonValue: number; atRisk: number; atRiskValue: number; unpriced: number }
export interface InsightsData {
  asOf: string; start: string; records: InsightRecord[]; eventRecords: InsightRecord[]; metrics: InsightMetrics; previous: InsightMetrics | null
  stages: InsightGroup[]; verticals: InsightGroup[]; departments: InsightGroup[]; states: InsightGroup[]
  owners: InsightGroup[]; presales: InsightGroup[]; team: InsightGroup[]; competitors: InsightGroup[]; attention: InsightGroup[]
  trend: InsightTrend[]; forecast: InsightGroup[]; options: { verticals: string[]; states: number[] }
}
export function insightValueCr(amount: string, unit: string, currency = 'INR'): number | null {
  const factors: Record<string, number> = { cr: 1, crore: 1, lakh: 0.01, thousand: 0.0001, rupee: 0.0000001, inr: 0.0000001 }
  const normalized = amount.trim().replace(/,/g, '')
  if (currency !== 'INR' || !/^\d+(?:\.\d+)?$/.test(normalized) || !Object.hasOwn(factors, unit.toLowerCase())) return null
  const result = Number(normalized) * factors[unit.toLowerCase()]
  return Number.isFinite(result) ? result : null
}
export function competitionNames(document: SynopsisNode | null | undefined): string[] {
  const names = new Set<string>()
  for (const node of document?.content ?? []) {
    const grid = node.type === 'grid' ? node.attrs?.grid as SynopsisGrid | undefined : undefined
    const column = grid?.columns?.find(c => /^competitor$/i.test(c.name.trim()))
    if (!column) continue
    for (const row of grid?.rows ?? []) {
      const name = row.cells[column.id]
      if (typeof name === 'string' && name.trim()) names.add(name.trim())
    }
  }
  return [...names]
}
export const insightIsOpen = (r: InsightRecord) => !PIPELINE_STAGE_MAP[r.opportunityStageKey]?.isClosed && !BID_STAGE_MAP[r.stageKey]?.closed
const open = insightIsOpen
const won = (r: InsightRecord) => PIPELINE_STAGE_MAP[r.opportunityStageKey]?.isWon === true
const lost = (r: InsightRecord) => r.opportunityStageKey === 'lost'
const risk = (r: InsightRecord) => open(r) && r.attentionFlag !== 'onTrack'
const sum = (rows: InsightRecord[]) => rows.reduce((n, r) => n + (r.valueCr ?? 0), 0)
function metrics(rows: InsightRecord[]): InsightMetrics {
  const active = rows.filter(open), wins = rows.filter(won), losses = rows.filter(lost), risks = rows.filter(risk)
  return { pipeline: sum(active), weighted: active.reduce((n, r) => n + (r.valueCr ?? 0) * (PIPELINE_STAGE_MAP[r.opportunityStageKey]?.probability ?? 0), 0),
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) * 100 : null,
    active: active.length, won: wins.length, lost: losses.length, wonValue: sum(wins), atRisk: risks.length, atRiskValue: sum(risks), unpriced: rows.filter(r => r.valueCr === null).length }
}
export function insightGroups(rows: InsightRecord[], keyOf: (r: InsightRecord) => string, labelOf: (key: string) => string = key => key): InsightGroup[] {
  const groups = new Map<string, InsightGroup>()
  for (const row of rows) {
    const key = keyOf(row) || 'Unassigned'
    const group = groups.get(key) ?? { key, label: labelOf(key), value: 0, count: 0, ids: [] }
    group.value += row.valueCr ?? 0; group.count++; group.ids.push(row.id); groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.value - a.value || b.count - a.count || a.label.localeCompare(b.label))
}
const iso = (date: Date) => date.toISOString().slice(0, 10)
const monthStart = (today: string, offset: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return iso(d) }
const day = (value: string) => value.slice(0, 10)
export function computeInsights(source: InsightRecord[], filters: InsightsFilters, today = iso(new Date())): InsightsData {
  // One opportunity is one financial fact, even if imported data contains duplicate bid rows.
  const unique = new Map<string, InsightRecord>()
  for (const row of [...source].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))) {
    if (row.status !== 'archived' && day(row.createdAt) <= today && !unique.has(row.opportunityId)) unique.set(row.opportunityId, row)
  }
  const all = [...unique.values()]
  const selected = all.filter(r => (!filters.vertical || r.vertical === filters.vertical) && (filters.stateCode === undefined || r.stateCode === filters.stateCode)
    && (!filters.search || `${r.name} ${r.department} ${r.owner}`.toLowerCase().includes(filters.search.toLowerCase().trim())))
  const months = [0, 3, 6, 12, 24].includes(filters.months) ? filters.months : 12
  const start = months ? monthStart(today, 1 - months) : '0000-01-01'
  const previousStart = months ? monthStart(start, -months) : null
  const records = selected.filter(r => day(r.createdAt) >= start)
  const prior = previousStart ? selected.filter(r => day(r.createdAt) >= previousStart && day(r.createdAt) < start) : []
  const active = records.filter(open)
  const trend: InsightTrend[] = []
  const earliest = selected.reduce((first, r) => day(r.createdAt) < first ? day(r.createdAt) : first, today)
  const trendStart = months ? start : earliest > monthStart(today, -59) ? monthStart(earliest, 0) : monthStart(today, -59)
  for (let key = trendStart; key <= today; key = monthStart(key, 1)) {
    const next = monthStart(key, 1)
    const intake = selected.filter(r => day(r.createdAt) >= key && day(r.createdAt) < next)
    const closed = selected.filter(r => r.closedOn && day(r.closedOn) >= key && day(r.closedOn) < next && day(r.closedOn) <= today)
    const m = metrics(intake), wins = closed.filter(won), losses = closed.filter(lost)
    trend.push({ key, label: new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }), value: sum(intake), count: intake.length,
      wonValue: sum(wins), wonCount: wins.length, lostValue: sum(losses), lostCount: losses.length, pipeline: m.pipeline, weighted: m.weighted, active: m.active, winRate: m.winRate ?? 0 })
  }
  const competitors = insightGroups(records.flatMap(r => r.competitors.map(name => ({ ...r, owner: name }))), r => r.owner)
  return { asOf: today, start, records, eventRecords: selected.filter(r => day(r.createdAt) >= start || !!r.closedOn && day(r.closedOn) >= start), metrics: metrics(records), previous: months ? metrics(prior) : null,
    stages: insightGroups(records, r => r.stageKey, key => BID_STAGE_MAP[key]?.label ?? key).sort((a, b) => (BID_STAGE_MAP[a.key]?.order ?? 999) - (BID_STAGE_MAP[b.key]?.order ?? 999)),
    verticals: insightGroups(active, r => r.vertical), departments: insightGroups(active, r => r.department), states: insightGroups(active, r => r.stateCode === null ? 'unassigned' : String(r.stateCode)),
    owners: insightGroups(records, r => r.owner), presales: insightGroups(records, r => r.presales), team: insightGroups(records, r => r.team), competitors,
    attention: insightGroups(records, r => r.attentionFlag), trend,
    forecast: insightGroups(active, r => r.dueAt && !Number.isNaN(Date.parse(r.dueAt)) ? `${new Date(r.dueAt).getUTCFullYear()} Q${Math.floor(new Date(r.dueAt).getUTCMonth() / 3) + 1}` : 'Unscheduled'),
    options: { verticals: [...new Set(all.map(r => r.vertical).filter(Boolean))].sort(), states: [...new Set(all.flatMap(r => r.stateCode === null ? [] : [r.stateCode]))].sort((a, b) => a - b) } }
}

import { currentPeriod } from './time.js'
import { COUNT_FIELD, type InsightReport, type InsightVisual, type QueryFilter, type ReportWidget, type VisualSpec } from './types.js'

/** Built-in visuals and report templates. Read-only seeds: they live in code, appear in every library, and are copied
 *  ("Save as my report" / "Duplicate") before editing. Ids start with BUILT_IN_PREFIX. */

export const BUILT_IN_PREFIX = 'builtin:'
/** periodField value meaning "ignore the report period" (e.g. live bids are live regardless of when they started). */
export const NO_PERIOD = 'none'

const SEEDED_AT = '2026-10-15T00:00:00.000Z'
const MASTER = 'opportunities.master'
const OPEN: QueryFilter = { field: 'isOpen', op: 'isTrue' }
const WON: QueryFilter = { field: 'isWon', op: 'isTrue' }
const sumValue = { field: 'valueCr', agg: 'sum', format: 'currency' } as const
const count = { field: COUNT_FIELD, agg: 'count' } as const

function visual(key: string, name: string, description: string, spec: VisualSpec): InsightVisual {
  return { id: `${BUILT_IN_PREFIX}${key}`, name, description, spec, ownerEmail: 'GOMS', shared: true, builtIn: true, createdAt: SEEDED_AT, updatedAt: SEEDED_AT }
}
const kpi = (datasetId: string, measure: VisualSpec['query']['measures'][number], filters: QueryFilter[], periodField?: string): VisualSpec =>
  ({ chart: 'kpi', compare: true, periodField, query: { datasetId, dimensions: [], measures: [measure], filters } })
const by = (chart: VisualSpec['chart'], datasetId: string, field: string, measure: VisualSpec['query']['measures'][number], filters: QueryFilter[], extra: Partial<VisualSpec> = {}, limit?: number): VisualSpec =>
  ({ chart, ...extra, query: { datasetId, dimensions: [{ field }], measures: [measure], filters, ...(limit ? { sort: { by: measure.field === COUNT_FIELD ? 'count' : `${measure.agg}_${measure.field}`, dir: 'desc' as const }, limit } : {}) } })

export const BUILT_IN_VISUALS: readonly InsightVisual[] = [
  visual('pipeline-value', 'Open pipeline value', 'Value of open opportunities created in the period', kpi(MASTER, sumValue, [OPEN])),
  visual('pipeline-count', 'Open opportunities', 'Number of open opportunities created in the period', kpi(MASTER, count, [OPEN])),
  visual('pipeline-trend', 'Pipeline trend', 'Value of new opportunities by month of creation', { chart: 'area', query: { datasetId: MASTER, dimensions: [{ field: 'createdAt', grain: 'month' }], measures: [sumValue], filters: [] } }),
  visual('pipeline-by-stage', 'Pipeline by stage', 'Open value in each opportunity stage', by('funnel', MASTER, 'pipelineStage', sumValue, [OPEN])),
  visual('value-by-vertical', 'Pipeline by vertical', 'Share of open value by vertical', by('donut', MASTER, 'vertical', sumValue, [OPEN])),
  visual('top-departments', 'Top departments', 'Departments ranked by open value', by('bar', MASTER, 'department', sumValue, [OPEN], {}, 10)),
  visual('campaign-count', 'Campaign opportunities', 'Campaign opportunities created in the period', kpi('opportunities.campaign', count, [])),
  visual('campaign-value', 'Campaign value', 'Value of campaign opportunities created in the period', kpi('opportunities.campaign', sumValue, [])),
  visual('campaign-by-vertical', 'Campaign by vertical', 'Campaign opportunities per vertical', by('bar', 'opportunities.campaign', 'vertical', count, [], {}, 10)),
  visual('live-bids-by-stage', 'Live bids by stage', 'Active, open Bid Tracker bids in each bid stage', by('funnel', 'opportunities.bidTracker', 'bidStage', count, [OPEN, { field: 'status', op: 'eq', value: 'active' }], { periodField: NO_PERIOD })),
  visual('live-bids-attention', 'Live bids needing attention', 'Open bids by attention flag', by('donut', 'opportunities.bidTracker', 'attention', count, [OPEN, { field: 'status', op: 'eq', value: 'active' }], { periodField: NO_PERIOD })),
  visual('orders-due-value', 'Orders due to close', 'Open opportunities whose due / expected close date falls in the period', kpi(MASTER, sumValue, [OPEN], 'submissionDate')),
  visual('orders-due-list', 'Orders due to close — top 10', 'The largest open opportunities expected to close in the period', by('table', MASTER, 'name', sumValue, [OPEN], { periodField: 'submissionDate' }, 10)),
  visual('orders-won-value', 'Orders won (value)', 'Value of opportunities closed as won in the period', kpi(MASTER, sumValue, [WON], 'closedOn')),
  visual('orders-won-count', 'Orders won', 'Opportunities closed as won in the period', kpi(MASTER, count, [WON], 'closedOn')),
  visual('win-rate', 'Win rate', 'Won ÷ (won + lost) for opportunities closed in the period', kpi(MASTER, { field: 'isWon', agg: 'avg', format: 'percent' }, [{ field: 'pipelineStage', op: 'in', value: ['won', 'lost'] }], 'closedOn')),
  visual('won-by-owner', 'Won value by sales owner', 'Who closed the most business in the period', by('bar', MASTER, 'owner', sumValue, [WON], { periodField: 'closedOn' }, 10)),
  visual('pipeline-by-owner', 'Open pipeline by sales owner', 'Open value each sales owner is carrying', by('bar', MASTER, 'owner', sumValue, [OPEN], {}, 10)),
  visual('presales-load', 'Presales load', 'Open Bid Tracker bids per presales owner', by('bar', 'opportunities.bidTracker', 'presales', count, [OPEN], { periodField: NO_PERIOD }, 10)),
  visual('milestones-overdue', 'Overdue milestones', 'Open bid milestones past their due date', { chart: 'kpi', periodField: NO_PERIOD, query: { datasetId: 'bidMilestones', dimensions: [], measures: [count], filters: [{ field: 'isOverdue', op: 'isTrue' }] } }),
  visual('milestones-by-month', 'Milestones due by month', 'Open milestone workload by due month', { chart: 'column', query: { datasetId: 'bidMilestones', dimensions: [{ field: 'dueAt', grain: 'month' }], measures: [count], filters: [{ field: 'status', op: 'eq', value: 'open' }] } }),
  visual('corrigenda-pending', 'Corrigenda pending review', 'Corrigenda still waiting for review', { chart: 'kpi', periodField: NO_PERIOD, query: { datasetId: 'bidCorrigenda', dimensions: [], measures: [count], filters: [{ field: 'status', op: 'eq', value: 'pending_review' }] } }),
  visual('corrigenda-by-impact', 'Corrigenda by impact', 'Corrigenda detected in the period by impact level', by('donut', 'bidCorrigenda', 'impactLevel', count, [])),
  visual('meetings-by-month', 'Customer meetings per month', 'Interactions logged with customer contacts', { chart: 'column', query: { datasetId: 'meetings', dimensions: [{ field: 'date', grain: 'month' }], measures: [count], filters: [] } }),
  visual('employees-by-team', 'Employees by team', 'Active headcount per team', by('bar', 'employees', 'team', count, [{ field: 'status', op: 'eq', value: 'active' }], { periodField: NO_PERIOD })),
]

const BUILT_IN_IDS = new Set(BUILT_IN_VISUALS.map((v) => v.id))
export const isBuiltInId = (id: string): boolean => id.startsWith(BUILT_IN_PREFIX)
export const isKnownBuiltInVisual = (id: string): boolean => BUILT_IN_IDS.has(id)
export const builtInVisual = (id: string): InsightVisual | undefined => BUILT_IN_VISUALS.find((v) => v.id === id)

let seq = 0
const w = (key: string, x: number, y: number, width: number, height: number, title?: string): ReportWidget =>
  ({ id: `w${++seq}`, kind: 'visual', visualId: `${BUILT_IN_PREFIX}${key}`, x, y, w: width, h: height, ...(title ? { title } : {}) })
const heading = (text: string, y: number): ReportWidget => ({ id: `w${++seq}`, kind: 'text', text, x: 0, y, w: 12, h: 1 })
const kpiRow = (keys: string[], y: number) => keys.map((k, i) => w(k, i * 3, y, 3, 2))

function report(key: string, name: string, description: string, widgets: ReportWidget[], period: InsightReport['filters']['period']): InsightReport {
  return { id: `${BUILT_IN_PREFIX}${key}`, name, description, widgets, filters: { period, calendar: 'fy' }, ownerEmail: 'GOMS', shared: true, builtIn: true, createdAt: SEEDED_AT, updatedAt: SEEDED_AT }
}

/** The built-in templates, with their period set relative to `today` (H1 of the current FY, the current quarter …). */
export function builtInReports(today: string): InsightReport[] {
  seq = 0
  const { fy, quarter } = currentPeriod(today)
  return [
    report('h1-review', 'H1 Review', 'Pipeline, campaign, live bids and the orders due and closed in the first half of the financial year.', [
      heading('Pipeline', 0), ...kpiRow(['pipeline-value', 'pipeline-count'], 1), w('pipeline-trend', 6, 1, 6, 4),
      w('pipeline-by-stage', 0, 3, 6, 4),
      heading('Campaign', 7), ...kpiRow(['campaign-count', 'campaign-value'], 8), w('campaign-by-vertical', 6, 8, 6, 4),
      heading('Live bids', 12), w('live-bids-by-stage', 0, 13, 6, 4), w('live-bids-attention', 6, 13, 6, 4),
      heading('Orders due to close in H1', 17), w('orders-due-value', 0, 18, 3, 2), w('orders-due-list', 3, 18, 9, 4),
      heading('Orders closed in H1', 22), ...kpiRow(['orders-won-value', 'orders-won-count', 'win-rate'], 23),
    ], { kind: 'half', fy, half: 1 }),
    report('quarterly-review', 'Quarterly Review', 'This quarter’s pipeline, wins and where the value sits.', [
      ...kpiRow(['pipeline-value', 'orders-won-value', 'win-rate', 'orders-due-value'], 0),
      w('pipeline-trend', 0, 2, 6, 4), w('value-by-vertical', 6, 2, 6, 4),
      w('top-departments', 0, 6, 6, 4), w('pipeline-by-stage', 6, 6, 6, 4),
    ], { kind: 'quarter', fy, quarter }),
    report('bid-health', 'Bid Health', 'Live bids, attention flags, milestone workload and corrigenda.', [
      ...kpiRow(['milestones-overdue', 'corrigenda-pending'], 0),
      w('live-bids-by-stage', 0, 2, 6, 4), w('live-bids-attention', 6, 2, 6, 4),
      w('milestones-by-month', 0, 6, 6, 4), w('corrigenda-by-impact', 6, 6, 6, 4),
    ], { kind: 'fy', fy }),
    report('team-performance', 'Team Performance', 'Wins, pipeline and workload by person and team for the financial year.', [
      w('won-by-owner', 0, 0, 6, 4), w('pipeline-by-owner', 6, 0, 6, 4),
      w('presales-load', 0, 4, 6, 4), w('meetings-by-month', 6, 4, 6, 4),
      w('employees-by-team', 0, 8, 6, 4),
    ], { kind: 'fy', fy }),
  ]
}

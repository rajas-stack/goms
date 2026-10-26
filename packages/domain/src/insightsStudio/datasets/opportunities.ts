import { BID_STAGE_MAP, BID_STAGES, OWNED_SHEET_LABELS, OWNED_SHEETS, type OwnedSheet } from '../../bids.js'
import { insightValueCr } from '../../insights.js'
import { PIPELINE_STAGE_MAP, PIPELINE_STAGES } from '../../opportunities.js'
import type { PolicyModuleKey } from '../../rbac/policy.js'
import { ageDays, boolDim, breakdown, dateDim, daysUntil, dim, enumDim, money, num, options, overdue, tagged } from '../fields.js'
import type { DataRow, DatasetDef, FieldDef, VisualSuggestion } from '../types.js'
import { COUNT_FIELD } from '../types.js'

/** Opportunities, one data source PER SHEET so lineage is explicit: a Live Bids visual only ever reads Live Bids
 *  rows, even though Campaign rows carry same-named attributes. Master is the collective view over every sheet.
 *  Row contract (built by the web adapter from bids.listForGrid joined with opportunities.list): every field key below
 *  that is not derived, plus `valueAmount`, `valueUnit` and `currency`. */

const str = (row: DataRow, key: string) => (typeof row[key] === 'string' ? (row[key] as string) : '')

export const opportunityIsOpen = (row: DataRow): boolean =>
  !PIPELINE_STAGE_MAP[str(row, 'pipelineStage')]?.isClosed && !BID_STAGE_MAP[str(row, 'bidStage')]?.closed
const isWon = (row: DataRow) => PIPELINE_STAGE_MAP[str(row, 'pipelineStage')]?.isWon === true
const valueCr = (row: DataRow) => insightValueCr(str(row, 'valueAmount'), str(row, 'valueUnit'), str(row, 'currency') || 'INR')

const ATTENTION = options([['onTrack', 'On track'], ['dueSoon', 'Due soon'], ['overdue', 'Overdue'], ['corrigendumPending', 'Corrigendum pending']])

function opportunityFields(withSheet: boolean): FieldDef[] {
  return [
    dim('name', 'Opportunity'),
    dim('opportunityCode', 'Opportunity ID'),
    ...(withSheet ? [enumDim('sheet', 'Sheet', OWNED_SHEETS.map((value) => ({ value, label: OWNED_SHEET_LABELS[value] })), breakdown)] : []),
    dim('department', 'Department', breakdown),
    dim('state', 'State', { ...tagged('state'), breakdown: true }),
    dim('city', 'City'),
    dim('vertical', 'Vertical', { ...tagged('vertical'), breakdown: true }),
    dim('opportunityType', 'Opportunity type', breakdown),
    enumDim('pipelineStage', 'Opportunity stage', PIPELINE_STAGES.map((s) => ({ value: s.key, label: s.label })), breakdown),
    enumDim('bidStage', 'Bid stage', BID_STAGES.map((s) => ({ value: s.key, label: s.label })), breakdown),
    enumDim('decision', 'Bid decision', options([['pending', 'Pending'], ['go', 'Go'], ['no_go', 'No-go']])),
    enumDim('status', 'Row status', options([['active', 'Active'], ['archived', 'Archived']])),
    enumDim('attention', 'Attention', ATTENTION),
    dim('owner', 'Sales owner', tagged('owner')),
    dim('presales', 'Presales', tagged('owner')),
    dim('bidTeam', 'Bid team member', tagged('owner')),
    dateDim('createdAt', 'Created'),
    dateDim('publishDate', 'Published'),
    dateDim('submissionDate', 'Due / expected close', { description: 'Bid submission date — the expected close date of the order' }),
    dateDim('closedOn', 'Closed on'),
    dateDim('nextMilestoneDueAt', 'Next milestone due'),
    money('valueCr', 'Value (INR Cr)', { ...tagged('value'), derive: valueCr, description: 'Recorded value converted to INR crore; foreign currency and unknown units are left out' }),
    money('weightedValueCr', 'Weighted value (INR Cr)', {
      derive: (row) => { const v = valueCr(row); return v === null ? null : v * (PIPELINE_STAGE_MAP[str(row, 'pipelineStage')]?.probability ?? 0) },
      description: 'Value × the stage win probability',
    }),
    num('documentCount', 'Tender documents'),
    ageDays('ageDays', 'Age (days)', 'createdAt'),
    daysUntil('daysToDue', 'Days to due date', 'submissionDate'),
    boolDim('isOpen', 'Is open', { derive: opportunityIsOpen, description: 'Neither the opportunity nor the bid stage is closed' }),
    boolDim('isWon', 'Is won', { derive: isWon }),
    boolDim('isLost', 'Is lost', { derive: (row) => str(row, 'pipelineStage') === 'lost' }),
    overdue('isOverdue', 'Is overdue', 'submissionDate', opportunityIsOpen),
  ]
}

function suggestions(id: string, noun: string): VisualSuggestion[] {
  const base = { datasetId: id, filters: [] as const }
  return [
    { name: `Open ${noun} value`, description: 'Total value of open opportunities, with the change vs the previous period', spec: { chart: 'kpi', compare: true, query: { ...base, dimensions: [], measures: [{ field: 'valueCr', agg: 'sum', format: 'currency' }], filters: [{ field: 'isOpen', op: 'isTrue' }] } } },
    { name: `${noun} trend`, description: 'New opportunities by month of creation', spec: { chart: 'line', query: { ...base, dimensions: [{ field: 'createdAt', grain: 'month' }], measures: [{ field: COUNT_FIELD, agg: 'count' }] } } },
    { name: `${noun} by stage`, description: 'Value in each opportunity stage', spec: { chart: 'funnel', query: { ...base, dimensions: [{ field: 'pipelineStage' }], measures: [{ field: 'valueCr', agg: 'sum', format: 'currency' }] } } },
    { name: `${noun} by vertical`, description: 'Share of value by vertical', spec: { chart: 'donut', query: { ...base, dimensions: [{ field: 'vertical' }], measures: [{ field: 'valueCr', agg: 'sum', format: 'currency' }] } } },
    { name: `Top departments (${noun})`, description: 'Departments ranked by value', spec: { chart: 'bar', query: { ...base, dimensions: [{ field: 'department' }], measures: [{ field: 'valueCr', agg: 'sum', format: 'currency' }], sort: { by: 'sum_valueCr', dir: 'desc' }, limit: 10 } } },
  ]
}

interface SheetSource { id: string; label: string; sheet: OwnedSheet | null; rbac: PolicyModuleKey[]; description: string; noun: string }

const SOURCES: SheetSource[] = [
  { id: 'opportunities.bidTracker', label: 'Live Bids', sheet: 'bidTracker', rbac: ['opp.bidTracker'], noun: 'Live Bids', description: 'Live bids being prepared and submitted, with their bid stage, decision, attention flag and due dates.' },
  { id: 'opportunities.pipelineFunnel', label: 'Pipeline · Funnel', sheet: 'pipeline-funnel', rbac: ['opp.pipeline'], noun: 'Funnel', description: 'Early pipeline opportunities in the Funnel sheet.' },
  { id: 'opportunities.pipelineBackup', label: 'Pipeline · Backup', sheet: 'pipeline-backup', rbac: ['opp.pipeline'], noun: 'Backup', description: 'Backup pipeline opportunities.' },
  { id: 'opportunities.pipelineCommits', label: 'Pipeline · Commits', sheet: 'pipeline-commits', rbac: ['opp.pipeline'], noun: 'Commits', description: 'Committed pipeline opportunities expected to convert.' },
  { id: 'opportunities.campaign', label: 'Campaign', sheet: 'campaign', rbac: ['opp.campaign'], noun: 'Campaign', description: 'Campaign-sourced opportunities.' },
  { id: 'opportunities.master', label: 'Master (all sheets)', sheet: null, rbac: ['opp.bidTracker', 'opp.pipeline', 'opp.campaign'], noun: 'Opportunity', description: 'Every opportunity across all sheets, with the sheet it lives in.' },
]

/** Dataset id → the sheet its rows come from (null = every sheet). */
export const OPPORTUNITY_SHEET_OF: Readonly<Record<string, OwnedSheet | null>> = Object.fromEntries(SOURCES.map((s) => [s.id, s.sheet]))

export const OPPORTUNITY_DATASETS: DatasetDef[] = SOURCES.map((s) => ({
  id: s.id,
  label: s.label,
  module: s.sheet ? `Opportunity › ${OWNED_SHEET_LABELS[s.sheet]}` : 'Opportunity › Master',
  description: s.description,
  rbacModules: s.rbac,
  fields: opportunityFields(s.sheet === null),
  timeField: 'createdAt',
  defaultMeasure: 'valueCr',
  rowNoun: 'opportunity',
  suggestions: suggestions(s.id, s.noun),
}))

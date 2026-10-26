import { CORRIGENDUM_IMPACT_LABELS, CORRIGENDUM_IMPACT_LEVELS, CORRIGENDUM_REVIEW_STATUS_LABELS, CORRIGENDUM_REVIEW_STATUSES } from '../../corrigenda.js'
import { ageDays, boolDim, breakdown, dateDim, daysUntil, dim, enumDim, num, options, overdue } from '../fields.js'
import type { DatasetDef } from '../types.js'
import { COUNT_FIELD } from '../types.js'

/** Work items hanging off a bid: milestones and corrigenda. Rows carry the bid code and opportunity name of the bid
 *  they belong to (the same record, not a cross-source lookup). */

const milestoneOpen = (row: { readonly [key: string]: unknown }) => row.status === 'open'

export const BID_MILESTONES: DatasetDef = {
  id: 'bidMilestones',
  label: 'Bid milestones',
  module: 'Opportunity › Live Bids › Milestones',
  description: 'Every dated milestone of every bid (pre-bid meeting, submission, opening …) with its status.',
  rbacModules: ['bid.milestones'],
  rowNoun: 'milestone',
  timeField: 'dueAt',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('label', 'Milestone', breakdown),
    dim('milestoneType', 'Milestone type', breakdown),
    enumDim('status', 'Status', options([['open', 'Open'], ['completed', 'Completed'], ['superseded', 'Superseded']]), breakdown),
    enumDim('source', 'Source', options([['manual', 'Manual'], ['corrigendum', 'Corrigendum']]), breakdown),
    dim('bidCode', 'Bid code'),
    dim('opportunityName', 'Opportunity'),
    dateDim('dueAt', 'Due'),
    dateDim('createdAt', 'Created'),
    daysUntil('daysToDue', 'Days to due', 'dueAt'),
    overdue('isOverdue', 'Is overdue', 'dueAt', milestoneOpen),
  ],
  suggestions: [
    { name: 'Milestones due by month', description: 'Upcoming workload by due month', spec: { chart: 'column', query: { datasetId: 'bidMilestones', dimensions: [{ field: 'dueAt', grain: 'month' }], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [{ field: 'status', op: 'eq', value: 'open' }] } } },
    { name: 'Overdue milestones', description: 'Open milestones whose due date has passed', spec: { chart: 'kpi', query: { datasetId: 'bidMilestones', dimensions: [], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [{ field: 'isOverdue', op: 'isTrue' }] } } },
  ],
}

export const BID_CORRIGENDA: DatasetDef = {
  id: 'bidCorrigenda',
  label: 'Corrigenda',
  module: 'Opportunity › Live Bids › Corrigenda',
  description: 'Tender corrigenda detected on bids, their impact and review progress.',
  rbacModules: ['bid.corrigenda'],
  rowNoun: 'corrigendum',
  timeField: 'detectedAt',
  defaultMeasure: COUNT_FIELD,
  fields: [
    dim('bidCode', 'Bid code'),
    dim('opportunityName', 'Opportunity'),
    num('corrigendumNumber', 'Corrigendum no.'),
    enumDim('status', 'Status', options([['pending_review', 'Pending review'], ['reviewed', 'Reviewed']]), breakdown),
    enumDim('reviewStatus', 'Review status', CORRIGENDUM_REVIEW_STATUSES.map((value) => ({ value, label: CORRIGENDUM_REVIEW_STATUS_LABELS[value] })), breakdown),
    enumDim('impactLevel', 'Impact level', CORRIGENDUM_IMPACT_LEVELS.map((value) => ({ value, label: CORRIGENDUM_IMPACT_LABELS[value] })), breakdown),
    boolDim('technicalImpact', 'Technical impact'),
    boolDim('commercialImpact', 'Commercial impact'),
    boolDim('submissionDateImpact', 'Moves submission date'),
    num('changeCount', 'Clause changes'),
    num('pendingChanges', 'Pending changes'),
    dateDim('detectedAt', 'Detected'),
    dateDim('publishedDate', 'Published'),
    ageDays('ageDays', 'Age (days)', 'detectedAt'),
  ],
  suggestions: [
    { name: 'Corrigenda by impact', description: 'How disruptive recent corrigenda are', spec: { chart: 'donut', query: { datasetId: 'bidCorrigenda', dimensions: [{ field: 'impactLevel' }], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [] } } },
    { name: 'Pending corrigendum reviews', description: 'Corrigenda still waiting for review', spec: { chart: 'kpi', query: { datasetId: 'bidCorrigenda', dimensions: [], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [{ field: 'status', op: 'eq', value: 'pending_review' }] } } },
  ],
}

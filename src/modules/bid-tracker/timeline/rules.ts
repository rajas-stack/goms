// Rule-based planned lifecycle. A plan is never stored or hardcoded: it is
// derived from the opportunity's start and end dates plus a percentage weight
// per phase, so a 30-, 60- or 180-day opportunity compresses proportionally.
import { addDays, diffDays, toDay } from './timelineDates'
import type { IsoDate, MilestoneTrack, OpportunityWorkflowKind } from './types'

export interface PhaseRule {
  key: string
  name: string
  /** Relative share of the available days (need not sum to 100). */
  weight: number
  /** False when this activity has no fixed planned timeline. */
  planned?: boolean
  track?: MilestoneTrack
  owner?: string
  /** Ordering against the bid stage machine; Sales pre-work uses negative slots. */
  statusOrder?: number
  icon?: string
}

export interface PlannedPhase {
  key: string
  name: string
  sequence: number
  plannedStart: IsoDate
  plannedEnd: IsoDate
  planned?: boolean
  track?: MilestoneTrack
  owner?: string
  statusOrder?: number
  icon?: string
}

/** Default weights for the open bid stages (BID_STAGES order). Submission is a
 *  short final window before the deadline. */
export const BID_PHASE_RULES: readonly PhaseRule[] = [
  { key: 'solutioning', name: 'Solutioning', weight: 30, track: 'presales', owner: 'Pre-Sales', statusOrder: 0, icon: 'Lightbulb' },
  { key: 'qualification', name: 'Qualification', weight: 15, track: 'presales', owner: 'CXO / Pre-Sales', statusOrder: 1, icon: 'ClipboardCheck' },
  { key: 'preBidQueries', name: 'Pre-bid Queries', weight: 20, track: 'presales', owner: 'Pre-Sales / Sales', statusOrder: 2, icon: 'MessageSquareText' },
  { key: 'commercialProposal', name: 'Commercial Proposal', weight: 30, track: 'presales', owner: 'Pre-Sales / Commercial', statusOrder: 3, icon: 'FileText' },
  { key: 'submitted', name: 'Submitted', weight: 5, track: 'presales', owner: 'Pre-Sales', statusOrder: 4, icon: 'Flag' },
]

/** The shared activities from the opportunity workflow, in their business order. */
export const PRE_SALES_RULES: readonly PhaseRule[] = [
  { key: 'solutioning', name: 'Pre-Sales Validation (Accept / Reject)', weight: 7, track: 'presales', owner: 'Pre-Sales', statusOrder: 0, icon: 'ClipboardCheck' },
  { key: 'presales:synopsis', name: 'Synopsis Preparation & Submission', weight: 12, track: 'presales', owner: 'Pre-Sales', statusOrder: 0.25, icon: 'FileText' },
  { key: 'preBidQueries', name: 'Pre-Bid Queries Preparation', weight: 7, track: 'presales', owner: 'Pre-Sales', statusOrder: 2, icon: 'MessageSquareText' },
  { key: 'presales:preBidMeeting', name: 'Pre-Bid Meeting', weight: 3, track: 'presales', owner: 'Pre-Sales / Sales', statusOrder: 2.25, icon: 'Handshake' },
  { key: 'presales:queriesSubmission', name: 'Pre-Bid Queries Submission', weight: 3, track: 'presales', owner: 'Pre-Sales', statusOrder: 2.5, icon: 'Send' },
  { key: 'qualification', name: 'Opportunity Go / No-Go', weight: 5, track: 'presales', owner: 'CXO', statusOrder: 1, icon: 'CircleCheck' },
  { key: 'presales:technicalProposal', name: 'Technical Proposal Preparation', weight: 20, track: 'presales', owner: 'Pre-Sales', statusOrder: 3, icon: 'FilePenLine' },
  { key: 'commercialProposal', name: 'Commercial Proposal Preparation', weight: 15, track: 'presales', owner: 'Pre-Sales / Commercial', statusOrder: 3.25, icon: 'Calculator' },
  { key: 'presales:priceGoNoGo', name: 'Price Go / No-Go', weight: 3, track: 'presales', owner: 'CXO', statusOrder: 3.5, icon: 'CircleCheck' },
  { key: 'submitted', name: 'Bid Submission', weight: 5, track: 'presales', owner: 'Pre-Sales', statusOrder: 4, icon: 'FileUp' },
  { key: 'presales:technicalPresentation', name: 'Technical Presentation / Demonstration', weight: 6, track: 'presales', owner: 'Pre-Sales / BU', statusOrder: 4.25, icon: 'Presentation' },
  { key: 'presales:departmentQueries', name: 'Department Queries & Clarifications', weight: 5, track: 'presales', owner: 'Pre-Sales', statusOrder: 4.5, icon: 'MessageCircle' },
  { key: 'presales:technicalResult', name: 'Technical Evaluation Result', weight: 5, track: 'presales', owner: 'Pre-Sales', statusOrder: 4.75, icon: 'ClipboardCheck' },
  { key: 'presales:commercialResult', name: 'Commercial Evaluation Result', weight: 4, track: 'presales', owner: 'Sales / Pre-Sales', statusOrder: 4.9, icon: 'BarChart3' },
]

const unplanned = (key: string, name: string, owner: string, statusOrder: number, icon = 'Users'): PhaseRule => ({
  key, name, owner, statusOrder, weight: 1, planned: false, track: 'sales', icon,
})

export const REACTIVE_SALES_RULES: readonly PhaseRule[] = [
  unplanned('sales:rfpReceived', 'RFP Received', 'Sales', -2, 'Briefcase'),
  unplanned('sales:rfpForwarded', 'RFP Forwarded to Pre-Sales', 'Sales', -1, 'Send'),
]

export const CURATED_SALES_RULES: readonly PhaseRule[] = [
  unplanned('sales:productSolution', 'Product / Solution Identification', 'Sales / BU', -14, 'Lightbulb'),
  unplanned('sales:departmentIdentification', 'Department Identification', 'Sales', -13, 'Landmark'),
  unplanned('sales:stakeholderMapping', 'Stakeholder Mapping', 'Sales', -12, 'Users'),
  unplanned('sales:firstMeeting', 'First-Level Meeting', 'Sales', -11, 'Handshake'),
  unplanned('sales:buPresentation', 'BU Sales Presentation', 'BU / Sales', -10, 'Presentation'),
  unplanned('sales:marketingDiscussion', 'Marketing Discussion', 'Sales / Marketing', -9, 'MessageCircle'),
  unplanned('sales:conceptNote', 'Concept Note Submission', 'BU / Sales', -8, 'FileText'),
  unplanned('sales:conceptApproval', 'Concept Approval', 'Sales', -7, 'CircleCheck'),
  unplanned('sales:budgetApproval', 'Budget Approval', 'Sales', -6, 'Calculator'),
  unplanned('sales:finalBuMeeting', 'Final BU Sales Meeting', 'BU / Sales', -5, 'Handshake'),
  unplanned('sales:pqTqSubmission', 'PQ / TQ Submission', 'Sales / BU', -4, 'FileUp'),
  unplanned('sales:draftRfpSubmission', 'Draft RFP Submission', 'Sales / BU', -3, 'FilePenLine'),
  unplanned('sales:rfpPublished', 'RFP Published / Live', 'Sales', -2, 'Globe'),
  unplanned('sales:rfpReceivedForwarded', 'RFP Received & Forwarded to Pre-Sales', 'Sales', -1, 'Send'),
]

export const SALES_CLOSEOUT_RULES: readonly PhaseRule[] = [
  unplanned('sales:winnerDeclaration', 'Winner Declaration', 'Sales', 5, 'Flag'),
  unplanned('sales:workOrderReceived', 'Work Order Received', 'Sales', 6, 'FileText'),
]

export const PROJECT_HANDOFF_RULES: readonly PhaseRule[] = [
  { key: 'project:initiation', name: 'Project Initiation', owner: 'BU / Project Team', statusOrder: 7, weight: 1, planned: false, track: 'project', icon: 'GitBranch' },
]

export function opportunityWorkflowRules(kind: OpportunityWorkflowKind): readonly PhaseRule[] {
  const sales = kind === 'curatedOpportunity' ? CURATED_SALES_RULES : REACTIVE_SALES_RULES
  return [...sales, ...PRE_SALES_RULES, ...SALES_CLOSEOUT_RULES, ...PROJECT_HANDOFF_RULES]
}

export function workflowKindForOpportunityType(type: string | null | undefined): OpportunityWorkflowKind {
  const normalized = (type ?? '').trim().toLowerCase()
  return ['direct', 'curated', 'proactive', 'sales-proactive', 'curated opportunity'].includes(normalized) ? 'curatedOpportunity' : 'reactiveBid'
}

/** Default span used when an opportunity has no usable deadline. */
export const FALLBACK_DURATION_DAYS = 60

/**
 * Splits [start, end] into contiguous phases sized by weight. Boundaries are
 * shared (phase i ends on the day phase i+1 starts), so there are no gaps or
 * overlaps, and the last phase always ends exactly on `endDate`.
 */
export function generatePlannedPlan(startDate: IsoDate, endDate: IsoDate, rules: readonly PhaseRule[]): PlannedPhase[] {
  if (Number.isNaN(toDay(startDate)) || Number.isNaN(toDay(endDate))) throw new Error('Plan dates must be YYYY-MM-DD')
  if (toDay(endDate) < toDay(startDate)) throw new Error('Plan end date is before its start date')
  if (rules.length === 0) return []
  const plannedRules = rules.filter((r) => r.planned !== false)
  if (plannedRules.some((r) => !(r.weight > 0))) throw new Error('Every planned phase weight must be positive')
  const totalWeight = plannedRules.reduce((sum, r) => sum + r.weight, 0)
  const totalDays = diffDays(startDate, endDate)
  const boundaries = plannedRules.reduce<number[]>((acc, rule) => {
    const cumulative = acc.length === 0 ? 0 : acc[acc.length - 1]
    return [...acc, cumulative + rule.weight]
  }, [])
  const offsetAt = (i: number) => (i === 0 ? 0 : Math.round((totalDays * boundaries[i - 1]) / totalWeight))
  let plannedIndex = 0
  return rules.map((rule, i) => {
    const planned = rule.planned !== false
    const common = {
      key: rule.key,
      name: rule.name,
      sequence: i + 1,
      icon: rule.icon,
      track: rule.track,
      owner: rule.owner,
      statusOrder: rule.statusOrder,
    }
    if (!planned || plannedRules.length === 0) return { ...common, planned: false, plannedStart: startDate, plannedEnd: startDate }
    const index = plannedIndex++
    return {
      ...common,
      planned: true,
      plannedStart: addDays(startDate, offsetAt(index)),
      plannedEnd: index === plannedRules.length - 1 ? endDate : addDays(startDate, offsetAt(index + 1)),
    }
  })
}

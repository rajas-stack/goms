import { type OwnedSheet } from './bids.js'
import { isIsoDateOrTime } from './bidCustomFields.js'

/** Commercial maturity is separate from the tender's own bid-preparation stages. */
export const OPPORTUNITY_LIFECYCLE = [
  { sheet: 'campaign', label: 'Campaign', description: 'Discover the client need and build the relationship.' },
  { sheet: 'pipeline-funnel', label: 'Funnel', description: 'Qualify the need, budget and likely procurement timeline.' },
  { sheet: 'pipeline-backup', label: 'Backup', description: 'Develop the solution, buying process and competitive position.' },
  { sheet: 'pipeline-commits', label: 'Commit', description: 'Confirm the forecast and prepare the handover to bidding.' },
  { sheet: 'bidTracker', label: 'Live Bid', description: 'Prepare the tender response and track submission.' },
] as const satisfies readonly { sheet: OwnedSheet; label: string; description: string }[]

export type LifecycleData = Record<string, string>
export interface LifecycleField {
  key: string
  label: string
  sheet: OwnedSheet
  type: 'text' | 'date'
  multiline?: boolean
}

/** Starter sales fields; maintainable choice lists continue to use Settings > Masters. */
export const LIFECYCLE_FIELDS: readonly LifecycleField[] = [
  { key: 'leadSource', label: 'Lead source', sheet: 'campaign', type: 'text' },
  { key: 'clientNeed', label: 'Client need', sheet: 'campaign', type: 'text', multiline: true },
  { key: 'keyContact', label: 'Key contact / stakeholder', sheet: 'campaign', type: 'text' },
  { key: 'engagementNotes', label: 'Engagement notes', sheet: 'campaign', type: 'text', multiline: true },
  { key: 'solutionApproach', label: 'Proposed solution', sheet: 'pipeline-funnel', type: 'text', multiline: true },
  { key: 'budgetNotes', label: 'Budget / estimated value', sheet: 'pipeline-funnel', type: 'text' },
  { key: 'qualificationNotes', label: 'Qualification evidence', sheet: 'pipeline-funnel', type: 'text', multiline: true },
  { key: 'expectedRfpDate', label: 'Expected RFP date', sheet: 'pipeline-funnel', type: 'date' },
  { key: 'solutionFit', label: 'Solution fit', sheet: 'pipeline-backup', type: 'text', multiline: true },
  { key: 'buyingProcess', label: 'Buying / approval process', sheet: 'pipeline-backup', type: 'text', multiline: true },
  { key: 'competitivePosition', label: 'Competitive position', sheet: 'pipeline-backup', type: 'text', multiline: true },
  { key: 'risks', label: 'Risks and dependencies', sheet: 'pipeline-backup', type: 'text', multiline: true },
  { key: 'forecastCloseDate', label: 'Forecast close date', sheet: 'pipeline-commits', type: 'date' },
  { key: 'commitmentEvidence', label: 'Commitment evidence', sheet: 'pipeline-commits', type: 'text', multiline: true },
  { key: 'resourcePlan', label: 'Resource / partner plan', sheet: 'pipeline-commits', type: 'text', multiline: true },
  { key: 'handoverNotes', label: 'Bid handover notes', sheet: 'pipeline-commits', type: 'text', multiline: true },
]

export const lifecycleIndex = (sheet: OwnedSheet = 'bidTracker'): number => OPPORTUNITY_LIFECYCLE.findIndex(stage => stage.sheet === sheet)
export const lifecycleLabel = (sheet: OwnedSheet): string => OPPORTUNITY_LIFECYCLE[lifecycleIndex(sheet)].label
export const lifecycleSections = (sheet: OwnedSheet) => OPPORTUNITY_LIFECYCLE.slice(0, lifecycleIndex(sheet) + 1)
export const lifecycleMoveTargets = (sheet: OwnedSheet): OwnedSheet[] => OPPORTUNITY_LIFECYCLE
  .filter(stage => Math.abs(lifecycleIndex(stage.sheet) - lifecycleIndex(sheet)) === 1).map(stage => stage.sheet)

export function assertLifecycleMove(from: OwnedSheet, to: OwnedSheet): void {
  if (from !== to && !lifecycleMoveTargets(from).includes(to)) {
    throw new Error('Move one stage at a time: Campaign → Funnel → Backup → Commit → Live Bid. Backward moves are allowed.')
  }
}

export function furthestLifecycleSheet(current: OwnedSheet, reached?: OwnedSheet, next: OwnedSheet = current): OwnedSheet {
  return OPPORTUNITY_LIFECYCLE[Math.max(lifecycleIndex(current), lifecycleIndex(reached ?? current), lifecycleIndex(next))].sheet
}

/** Earlier lists retain the same record, even after a backward move. */
export function lifecycleRowInSheet(row: { sheet?: OwnedSheet; lifecycleReachedSheet?: OwnedSheet }, sheet: OwnedSheet | 'master'): boolean {
  return sheet === 'master' || lifecycleIndex(sheet) <= lifecycleIndex(furthestLifecycleSheet(row.sheet ?? 'bidTracker', row.lifecycleReachedSheet))
}

export function validateLifecycleData(patch: LifecycleData, current: OwnedSheet): void {
  for (const [key, value] of Object.entries(patch)) {
    const field = LIFECYCLE_FIELDS.find(candidate => candidate.key === key)
    if (!field) throw new Error(`Unknown lifecycle field: ${key}`)
    if (lifecycleIndex(field.sheet) > lifecycleIndex(current)) throw new Error(`${field.label} becomes available at ${lifecycleLabel(field.sheet)}.`)
    if (typeof value !== 'string' || value.length > 10000) throw new Error(`${field.label} must be text of at most 10,000 characters.`)
    if (field.type === 'date' && value && !isIsoDateOrTime(value)) {
      throw new Error(`${field.label} must be a valid date.`)
    }
  }
}
